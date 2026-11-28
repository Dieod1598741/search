import axios from 'axios';
import * as cheerio from 'cheerio';

export type ChannelType = 'NAVER' | 'COUPANG' | 'OPEN_MARKET';

export interface ScrapedItem {
  title: string;
  lprice: string;
  link: string;
  image: string;
  mallName: string;
  channel: ChannelType;
  shipping: number | null; // 0 = free shipping, >0 = fee, null = unknown
  optionName?: string;
  catalogUrl?: string;
  productId?: string;
}

export interface AggregatedSearchResult {
  items: ScrapedItem[];
  blockedChannels: Array<'naver' | 'coupang'>;
}

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
};

export function parseShippingFee(text?: string | null): number | null {
  if (!text) return null;
  const trimmed = String(text).trim();
  if (!trimmed) return null;
  if (/무료|무배|free|(?<![0-9,])0원/i.test(trimmed)) return 0;
  const match = trimmed.match(/(\d{1,3}(?:,\d{3})+|\d{3,5})\s*원?/);
  if (match) {
    const num = parseInt(match[1].replace(/,/g, ''), 10);
    if (!isNaN(num) && num >= 0 && num <= 30000) return num;
  }
  return null;
}

export function classifyMallChannel(mallName: string, fallback: ChannelType = 'OPEN_MARKET'): ChannelType {
  const lower = (mallName || '').toLowerCase();
  if (lower.includes('쿠팡') || lower.includes('coupang') || lower.includes('로켓')) {
    return 'COUPANG';
  }
  if (lower.includes('네이버') || lower.includes('naver') || lower.includes('스마트스토어')) {
    return 'NAVER';
  }
  return fallback;
}

/**
 * 1. Enuri Search Listing (Structured JSON-LD)
 */
export async function scrapeEnuriListing(query: string): Promise<ScrapedItem[]> {
  try {
    const res = await axios.get(`https://www.enuri.com/search.jsp?keyword=${encodeURIComponent(query)}`, {
      headers: DEFAULT_HEADERS,
      timeout: 8000,
    });

    if (typeof res.data !== 'string' || res.data.length < 1000) {
      return [];
    }

    const $ = cheerio.load(res.data);
    const items: ScrapedItem[] = [];

    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const raw = $(el).html();
        if (!raw) return;
        const json = JSON.parse(raw);
        const list = Array.isArray(json.itemListElement) ? json.itemListElement : [];

        for (const entry of list) {
          const it = entry.item || entry;
          const title = typeof it?.name === 'string' ? it.name.trim() : '';
          const rawPrice = it?.offers?.lowPrice ?? it?.offers?.price;
          const priceNum =
            typeof rawPrice === 'number'
              ? rawPrice
              : parseInt(String(rawPrice || '').replace(/[^0-9]/g, ''), 10);
          const link = typeof it?.url === 'string' ? it.url.trim() : '';
          const image = typeof it?.image === 'string' ? it.image.trim() : '';

          if (title && !isNaN(priceNum) && priceNum > 0) {
            const isCatalog = link.includes('price.enuri.com/catalog/');
            items.push({
              title,
              lprice: String(priceNum),
              link: link || `https://www.enuri.com/search.jsp?keyword=${encodeURIComponent(query)}`,
              image,
              mallName: '에누리',
              channel: 'OPEN_MARKET',
              shipping: null,
              catalogUrl: isCatalog ? link : undefined,
              productId: link || `enuri:${title}:${priceNum}`,
            });
          }
        }
      } catch {
        // Ignore non-product JSON-LD blocks
      }
    });

    return items;
  } catch (e) {
    console.error(`Enuri listing failed for "${query}":`, e instanceof Error ? e.message : e);
    return [];
  }
}

/**
 * 1.5 Enuri Catalog Deep Parser
 * Extracts real per-mall offers (Gmarket, 11st, Auction, LotteON, SSG, Naver, etc.)
 * including exact option name (e.g. "1개"), price, shipping fee, and direct link.
 */
export async function scrapeEnuriCatalogOffers(catalogUrl: string, fallbackTitle: string, fallbackImage: string): Promise<ScrapedItem[]> {
  try {
    const res = await axios.get(catalogUrl, {
      headers: DEFAULT_HEADERS,
      timeout: 7000,
    });
    if (typeof res.data !== 'string' || res.data.length < 1000) return [];

    // Unescape RSC string payload so embedded JSON fields are clean to match
    const normalized = res.data.replace(/\\"/g, '"').replace(/\\u0026/g, '&');
    const items: ScrapedItem[] = [];

    // Match individual mall offer objects embedded in Enuri's Next.js RSC stream
    const offerRegex =
      /"catalogName":"([^"]+)"[^}]*?"catalogOptionName":"([^"]*)"[^}]*?"saleStatus":"SALE"[^}]*?"price":(\d+)[^}]*?"mallName":"([^"]+)"[^}]*?"deliveryText":"([^"]*)"[^}]*?"purchaseLink":"([^"]+)"/g;

    let match: RegExpExecArray | null;
    while ((match = offerRegex.exec(normalized)) !== null) {
      const catalogName = match[1]?.trim() || fallbackTitle;
      const optionName = match[2]?.trim() || '';
      const priceNum = parseInt(match[3], 10);
      const mallName = match[4]?.trim() || '에누리';
      const deliveryText = match[5]?.trim() || '';
      const purchaseLink = match[6]?.trim() || catalogUrl;

      if (!catalogName || isNaN(priceNum) || priceNum <= 0) continue;

      const titleWithOption =
        optionName && !catalogName.includes(optionName) ? `${catalogName} ${optionName}` : catalogName;

      items.push({
        title: titleWithOption,
        lprice: String(priceNum),
        link: purchaseLink,
        image: fallbackImage,
        mallName,
        channel: classifyMallChannel(mallName, 'OPEN_MARKET'),
        shipping: parseShippingFee(deliveryText),
        optionName,
        catalogUrl,
        productId: purchaseLink,
      });
    }

    return items;
  } catch (e) {
    console.error(`Enuri catalog deep parse failed for ${catalogUrl}:`, e instanceof Error ? e.message : e);
    return [];
  }
}

/**
 * 2. Danawa Price Comparison Backup Scraper
 */
export async function scrapeDanawaDirectly(query: string): Promise<ScrapedItem[]> {
  try {
    const res = await axios.get(`https://search.danawa.com/dsearch.php?query=${encodeURIComponent(query)}`, {
      headers: DEFAULT_HEADERS,
      timeout: 7000,
    });

    if (typeof res.data !== 'string' || res.data.includes('DANAWA Notice') || res.data.length < 3000) {
      return [];
    }

    const $ = cheerio.load(res.data);
    const items: ScrapedItem[] = [];

    $('.product_list > li').each((_, el) => {
      const title = $(el).find('.prod_name > a').text().trim();
      const priceStr = $(el).find('.price_sect strong').first().text().replace(/[^0-9]/g, '').trim();
      const link = $(el).find('.prod_name > a').attr('href') || '';
      const rawImg =
        $(el).find('.thumb_image img').attr('data-original') ||
        $(el).find('.thumb_image img').attr('src') ||
        '';
      const image = rawImg.startsWith('//') ? `https:${rawImg}` : rawImg;

      const priceNum = parseInt(priceStr, 10);
      if (title && !isNaN(priceNum) && priceNum > 0) {
        items.push({
          title,
          lprice: String(priceNum),
          link: link || `https://search.danawa.com/dsearch.php?query=${encodeURIComponent(query)}`,
          image,
          mallName: '다나와',
          channel: 'OPEN_MARKET',
          shipping: null,
          productId: link || `danawa:${title}:${priceNum}`,
        });
      }
    });

    return items;
  } catch {
    return [];
  }
}

/**
 * 3. Direct Naver Shopping Scraper (Electron Persistent User Session)
 */
export async function scrapeNaverShoppingDirectly(
  query: string,
  port: string
): Promise<{ items: ScrapedItem[]; blocked: boolean }> {
  try {
    const targetUrl = `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(query)}&frm=NVSHATC&pagingIndex=1&pagingSize=40&productSet=total&sort=rel`;
    const scrapeEndpoint = `http://localhost:${port}/api/internal/scrape?url=${encodeURIComponent(targetUrl)}`;
    const res = await axios.get(scrapeEndpoint, { timeout: 14000 });

    if (res.data?.blocked) {
      return { items: [], blocked: true };
    }
    if (!res.data || typeof res.data.html !== 'string' || !res.data.html) {
      return { items: [], blocked: false };
    }

    const $ = cheerio.load(res.data.html);
    const items: ScrapedItem[] = [];

    // Strategy A: Parse __NEXT_DATA__ embedded JSON (cleanest & richest)
    const nextDataStr = $('#__NEXT_DATA__').html();
    if (nextDataStr) {
      try {
        const nextData = JSON.parse(nextDataStr);
        const list =
          nextData?.props?.pageProps?.initialState?.products?.list ||
          nextData?.props?.pageProps?.compositeList?.list ||
          [];

        for (const entry of list) {
          const item = entry?.item || entry;
          const title = String(item?.productTitle || item?.productName || '').trim();
          const priceNum = parseInt(String(item?.lowPrice || item?.price || '').replace(/[^0-9]/g, ''), 10);
          const link = String(item?.mallProductUrl || item?.crUrl || item?.productUrl || '').trim();
          const mallName = String(item?.mallName || '네이버쇼핑').trim();
          const image = String(item?.imageUrl || '').trim();
          const shipping = parseShippingFee(String(item?.deliveryFeeContent ?? ''));

          if (title && !isNaN(priceNum) && priceNum > 0) {
            items.push({
              title,
              lprice: String(priceNum),
              link: link || targetUrl,
              image,
              mallName: mallName.includes('네이버') ? mallName : `네이버(${mallName})`,
              channel: classifyMallChannel(mallName, 'NAVER'),
              shipping,
              productId: String(item?.id || link || `naver:${title}:${priceNum}`),
            });
          }
        }
      } catch {
        // Fallback to DOM scraping below
      }
    }

    // Strategy B: Naver Shopping DOM fallback
    if (items.length === 0) {
      $('[class*="product_item__"], [class*="basicList_item__"]').each((_, el) => {
        const title = $(el).find('[class*="product_title__"] a, [class*="basicList_title__"] a').first().text().trim();
        const priceStr = $(el)
          .find('[class*="price_num__"]')
          .first()
          .text()
          .replace(/[^0-9]/g, '')
          .trim();
        const link =
          $(el).find('[class*="product_title__"] a, [class*="basicList_title__"] a').first().attr('href') || targetUrl;
        const mall = $(el).find('[class*="product_mall__"]').first().text().trim() || '네이버쇼핑';
        const delivery = $(el).find('[class*="price_delivery__"]').first().text().trim();
        const image = $(el).find('img').first().attr('src') || '';

        const priceNum = parseInt(priceStr, 10);
        if (title && !isNaN(priceNum) && priceNum > 0) {
          items.push({
            title,
            lprice: String(priceNum),
            link,
            image,
            mallName: mall.includes('네이버') ? mall : `네이버(${mall})`,
            channel: classifyMallChannel(mall, 'NAVER'),
            shipping: parseShippingFee(delivery),
            productId: link || `naver:${title}:${priceNum}`,
          });
        }
      });
    }

    return { items, blocked: false };
  } catch (e) {
    console.error(`Naver Shopping scrape failed for "${query}":`, e instanceof Error ? e.message : e);
    return { items: [], blocked: false };
  }
}

/**
 * 4. Direct Coupang Scraper (Electron Persistent User Session)
 */
export async function scrapeCoupangDirectly(
  query: string,
  port: string
): Promise<{ items: ScrapedItem[]; blocked: boolean }> {
  try {
    const targetUrl = `https://www.coupang.com/np/search?q=${encodeURIComponent(query)}&page=1`;
    const scrapeEndpoint = `http://localhost:${port}/api/internal/scrape?url=${encodeURIComponent(targetUrl)}`;
    const res = await axios.get(scrapeEndpoint, { timeout: 14000 });

    if (res.data?.blocked) {
      return { items: [], blocked: true };
    }
    if (!res.data || typeof res.data.html !== 'string' || !res.data.html) {
      return { items: [], blocked: false };
    }

    const $ = cheerio.load(res.data.html);
    const items: ScrapedItem[] = [];

    // Strategy A: Legacy Coupang DOM
    $('li.search-product').each((_, el) => {
      const title = $(el).find('.name').text().trim();
      const priceStr = $(el).find('.price-value').first().text().replace(/[^0-9]/g, '').trim();
      let link = $(el).find('a.search-product-link').attr('href') || '';
      const rawImg = $(el).find('img.search-product-wrap-img').attr('src') || '';
      const image = rawImg.startsWith('//') ? `https:${rawImg}` : rawImg;
      const isRocket = $(el).find('.badge.rocket, img[alt*="로켓"]').length > 0;
      const deliveryText = $(el).find('.delivery').text().trim();

      const priceNum = parseInt(priceStr, 10);
      if (title && !isNaN(priceNum) && priceNum > 0) {
        if (link && !link.startsWith('http')) {
          link = 'https://www.coupang.com' + link;
        }
        items.push({
          title,
          lprice: String(priceNum),
          link,
          image,
          mallName: isRocket ? '쿠팡 로켓배송' : '쿠팡',
          channel: 'COUPANG',
          shipping: isRocket ? 0 : parseShippingFee(deliveryText),
          productId: link || `coupang:${title}:${priceNum}`,
        });
      }
    });

    // Strategy B: Newer Coupang React DOM
    if (items.length === 0) {
      $('li[class*="ProductUnit_productUnit"], li[data-id]').each((_, el) => {
        const title = $(el)
          .find('[class*="ProductUnit_productName"], [class*="productName"]')
          .first()
          .text()
          .trim();
        const priceStr = $(el)
          .find('[class*="PriceArea_priceArea"] strong, [class*="price-value"]')
          .first()
          .text()
          .replace(/[^0-9]/g, '')
          .trim();
        let link = $(el).find('a[href*="/vp/products/"]').first().attr('href') || '';
        const rawImg = $(el).find('img').first().attr('src') || '';
        const image = rawImg.startsWith('//') ? `https:${rawImg}` : rawImg;
        const isRocket = /로켓/.test($(el).text()) || $(el).find('img[alt*="로켓"]').length > 0;

        const priceNum = parseInt(priceStr, 10);
        if (title && !isNaN(priceNum) && priceNum > 0) {
          if (link && !link.startsWith('http')) {
            link = 'https://www.coupang.com' + link;
          }
          items.push({
            title,
            lprice: String(priceNum),
            link,
            image,
            mallName: isRocket ? '쿠팡 로켓배송' : '쿠팡',
            channel: 'COUPANG',
            shipping: isRocket ? 0 : null,
            productId: link || `coupang:${title}:${priceNum}`,
          });
        }
      });
    }

    return { items, blocked: false };
  } catch (e) {
    console.error(`Coupang scrape failed for "${query}":`, e instanceof Error ? e.message : e);
    return { items: [], blocked: false };
  }
}

/**
 * Aggregated 3-channel fetcher:
 *  - Open Markets (Enuri listing + optional top catalog deep-parse + Danawa backup)
 *  - Naver Shopping (Electron persistent session + Enuri Naver offers)
 *  - Coupang (Electron persistent session)
 */
export async function fetchAggregatedCandidates(
  query: string,
  options?: {
    port?: string;
    includeSessionChannels?: boolean;
    deepCatalogUrls?: string[];
  }
): Promise<AggregatedSearchResult> {
  const useSession = Boolean(options?.includeSessionChannels && options?.port);
  const port = options?.port || '';

  const [enuriItems, danawaItems, naverRes, coupangRes] = await Promise.all([
    scrapeEnuriListing(query),
    scrapeDanawaDirectly(query),
    useSession ? scrapeNaverShoppingDirectly(query, port) : Promise.resolve({ items: [], blocked: false }),
    useSession ? scrapeCoupangDirectly(query, port) : Promise.resolve({ items: [], blocked: false }),
  ]);

  const blockedChannels: Array<'naver' | 'coupang'> = [];
  if (naverRes.blocked) blockedChannels.push('naver');
  if (coupangRes.blocked) blockedChannels.push('coupang');

  const combined = [...enuriItems, ...danawaItems, ...naverRes.items, ...coupangRes.items];

  const uniqueMap = new Map<string, ScrapedItem>();
  for (const item of combined) {
    const key = item.productId || item.link || `${item.channel}:${item.mallName}:${item.title}:${item.lprice}`;
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, item);
    }
  }

  return {
    items: Array.from(uniqueMap.values()),
    blockedChannels,
  };
}
