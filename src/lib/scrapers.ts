import axios from 'axios';
import * as cheerio from 'cheerio';

export interface ScrapedItem {
  title: string;
  lprice: string;
  link: string;
  image: string;
  mallName: string;
  productId?: string;
}

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
};

/**
 * 1. Enuri Price Comparison Scraper (Structured JSON-LD)
 * Aggregates lowest prices across Korean open markets (Naver, Coupang, Gmarket, 11st, SSG, etc.).
 */
export async function scrapeEnuriDirectly(query: string): Promise<ScrapedItem[]> {
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
          const priceNum = typeof rawPrice === 'number' ? rawPrice : parseInt(String(rawPrice || '').replace(/[^0-9]/g, ''), 10);
          const link = typeof it?.url === 'string' ? it.url.trim() : '';
          const image = typeof it?.image === 'string' ? it.image.trim() : '';

          if (title && !isNaN(priceNum) && priceNum > 0) {
            items.push({
              title,
              lprice: String(priceNum),
              link: link || `https://www.enuri.com/search.jsp?keyword=${encodeURIComponent(query)}`,
              image,
              mallName: '에누리',
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
    console.error(`Enuri scrape failed for "${query}":`, e instanceof Error ? e.message : e);
    return [];
  }
}

/**
 * 2. Danawa Price Comparison Scraper
 */
export async function scrapeDanawaDirectly(query: string): Promise<ScrapedItem[]> {
  try {
    const res = await axios.get(`https://search.danawa.com/dsearch.php?query=${encodeURIComponent(query)}`, {
      headers: DEFAULT_HEADERS,
      timeout: 8000,
    });

    if (typeof res.data !== 'string' || res.data.includes('DANAWA Notice') || res.data.length < 1000) {
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
          productId: link || `danawa:${title}:${priceNum}`,
        });
      }
    });

    return items;
  } catch (e) {
    console.error(`Danawa scrape failed for "${query}":`, e instanceof Error ? e.message : e);
    return [];
  }
}

/**
 * 3. Direct Coupang Scraper (Using Electron Invisible Browser)
 * Supports both legacy (`li.search-product`) and newer React Coupang product unit markup.
 */
export async function scrapeCoupangDirectly(query: string, port: string): Promise<ScrapedItem[]> {
  const fetchPage = async (page: number): Promise<ScrapedItem[]> => {
    try {
      const targetUrl = `https://www.coupang.com/np/search?q=${encodeURIComponent(query)}&page=${page}`;
      const scrapeEndpoint = `http://localhost:${port}/api/internal/scrape?url=${encodeURIComponent(targetUrl)}`;
      const res = await axios.get(scrapeEndpoint, { timeout: 14000 });

      if (!res.data || typeof res.data.html !== 'string') {
        return [];
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
            mallName: '쿠팡',
            productId: link || `coupang:${title}:${priceNum}`,
          });
        }
      });

      // Strategy B: Newer Coupang React DOM fallback
      if (items.length === 0) {
        $('li[class*="ProductUnit_productUnit"], li[data-id]').each((_, el) => {
          const title = $(el)
            .find('[class*="ProductUnit_productName"], [class*="productName"]')
            .first()
            .text()
            .trim();
          const priceStr = $(el)
            .find('[class*="PriceArea_priceArea"] strong, [class*="price-value"], [class*="custom-oos"] ~ * strong')
            .first()
            .text()
            .replace(/[^0-9]/g, '')
            .trim();
          let link = $(el).find('a[href*="/vp/products/"]').first().attr('href') || '';
          const rawImg = $(el).find('img').first().attr('src') || '';
          const image = rawImg.startsWith('//') ? `https:${rawImg}` : rawImg;

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
              mallName: '쿠팡',
              productId: link || `coupang:${title}:${priceNum}`,
            });
          }
        });
      }

      return items;
    } catch (e) {
      console.error(`Coupang scrape failed for page ${page}:`, e instanceof Error ? e.message : e);
      return [];
    }
  };

  const [page1, page2] = await Promise.all([fetchPage(1), fetchPage(2)]);
  return [...page1, ...page2];
}

/**
 * Aggregated multi-source fetcher (Enuri + Danawa + optional Electron Coupang).
 * Automatically survives single-source maintenance or downtime.
 */
export async function fetchAggregatedCandidates(
  query: string,
  options?: { port?: string; includeCoupang?: boolean }
): Promise<ScrapedItem[]> {
  const [enuriItems, danawaItems, coupangItems] = await Promise.all([
    scrapeEnuriDirectly(query),
    scrapeDanawaDirectly(query),
    options?.includeCoupang && options?.port
      ? scrapeCoupangDirectly(query, options.port)
      : Promise.resolve([]),
  ]);

  const combined = [...enuriItems, ...danawaItems, ...coupangItems];

  // Deduplicate by link or mall+title+price
  const uniqueMap = new Map<string, ScrapedItem>();
  for (const item of combined) {
    const key = item.productId || item.link || `${item.mallName}:${item.title}:${item.lprice}`;
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, item);
    }
  }

  return Array.from(uniqueMap.values());
}
