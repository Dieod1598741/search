import { NextRequest, NextResponse } from 'next/server';
import pool, { ensureProductSchema } from '@/lib/db';
import { normalizeCategory } from '@/lib/categories';
import { evaluateCandidate, isPriceOutlier } from '@/lib/searchFilters';
import axios from 'axios';
import * as cheerio from 'cheerio';

// 1. Direct Coupang Scraper (Using Electron Invisible Browser)
async function scrapeCoupangDirectly(query: string, port: string): Promise<any[]> {
  const fetchPage = async (page: number) => {
    try {
      const targetUrl = `https://www.coupang.com/np/search?q=${encodeURIComponent(query)}&page=${page}`;
      const scrapeEndpoint = `http://localhost:${port}/api/internal/scrape?url=${encodeURIComponent(targetUrl)}`;
      const res = await axios.get(scrapeEndpoint);

      if (res.data && res.data.html) {
        const $ = cheerio.load(res.data.html);
        const items: any[] = [];

        $('li.search-product').each((i, el) => {
          const title = $(el).find('.name').text().trim();
          const priceStr = $(el).find('.price-value').text().trim().replace(/,/g, '');
          let link = $(el).find('a.search-product-link').attr('href');

          if (title && priceStr && !isNaN(parseInt(priceStr, 10))) {
            if (link && !link.startsWith('http')) {
              link = 'https://www.coupang.com' + link;
            }
            items.push({
              title,
              lprice: priceStr,
              link,
              mallName: '쿠팡',
            });
          }
        });
        return items;
      }
      return [];
    } catch (e) {
      console.error(`Coupang scrape failed for page ${page}:`, e);
      return [];
    }
  };

  // Scrape Page 1 and Page 2 in parallel for deeper search
  const [page1, page2] = await Promise.all([fetchPage(1), fetchPage(2)]);
  return [...page1, ...page2];
}

// 1.5 Direct Danawa Scraper (Fallback for Naver API)
async function scrapeDanawaDirectly(query: string): Promise<any[]> {
  try {
    const res = await axios.get(`https://search.danawa.com/dsearch.php?query=${encodeURIComponent(query)}`);
    const $ = cheerio.load(res.data);
    const items: any[] = [];
    $('.product_list > li').each((i, el) => {
      const title = $(el).find('.prod_name > a').text().trim();
      const priceStr = $(el).find('.price_sect strong').text().replace(/,/g, '').trim();
      const link = $(el).find('.prod_name > a').attr('href');

      if (title && priceStr && !isNaN(parseInt(priceStr, 10))) {
        items.push({
          title,
          lprice: priceStr,
          link: link || `https://search.danawa.com/dsearch.php?query=${encodeURIComponent(query)}`,
          mallName: '다나와',
        });
      }
    });
    return items;
  } catch (e) {
    console.error(`Danawa scrape failed for ${query}:`, e);
    return [];
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureProductSchema();
    const { productId, customKeyword, useDanawa } = await req.json();

    const { rows: productRows } = await pool.query('SELECT * FROM "Product" WHERE id = $1', [productId]);
    const product = productRows[0];

    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    if (product.isManualOverride) {
      return NextResponse.json({
        success: true,
        product,
        note: 'Skipped automated search due to manual override',
      });
    }

    const category = normalizeCategory(product.category);

    // --- Multi-stage Fallback Search Strategy ---
    const queries = customKeyword
      ? [customKeyword]
      : ([
          product.spec ? `${product.name} ${product.spec}` : product.name,
          product.barcode ? `${product.name} ${product.barcode}` : null,
          product.name,
        ].filter(Boolean) as string[]);

    const baseSearchName = customKeyword || product.name;

    const { rows: settings } = await pool.query('SELECT * FROM "Setting"');
    const config = settings.reduce((acc: Record<string, string>, curr) => {
      acc[curr.id] = curr.value;
      return acc;
    }, {});

    const NAVER_CLIENT_ID = config['NAVER_CLIENT_ID'] || '';
    const NAVER_CLIENT_SECRET = config['NAVER_CLIENT_SECRET'] || '';

    let naverPrice: number | null = null;
    let naverLink: string | null = null;
    let coupangPrice: number | null = null;
    let coupangLink: string | null = null;
    let fetchSuccess = false;

    if (useDanawa || (NAVER_CLIENT_ID && NAVER_CLIENT_SECRET)) {
      for (const query of queries) {
        if (fetchSuccess && naverPrice !== null && coupangPrice !== null) break;

        try {
          const [naverSim, naverAsc, coupangDirectItems, danawaItems] = await Promise.all([
            // Pass 1: Relevance (sim) - only if not using Danawa
            !useDanawa && NAVER_CLIENT_ID
              ? axios
                  .get('https://openapi.naver.com/v1/search/shop.json', {
                    params: { query: query, display: 100, sort: 'sim' },
                    headers: {
                      'X-Naver-Client-Id': NAVER_CLIENT_ID,
                      'X-Naver-Client-Secret': NAVER_CLIENT_SECRET,
                    },
                  })
                  .catch((e) => {
                    console.error('Naver API sim failed:', e);
                    return { data: { items: [] } };
                  })
              : Promise.resolve({ data: { items: [] } }),

            // Pass 2: Low Price (asc) - only if not using Danawa
            !useDanawa && NAVER_CLIENT_ID
              ? axios
                  .get('https://openapi.naver.com/v1/search/shop.json', {
                    params: { query: query, display: 100, sort: 'asc' },
                    headers: {
                      'X-Naver-Client-Id': NAVER_CLIENT_ID,
                      'X-Naver-Client-Secret': NAVER_CLIENT_SECRET,
                    },
                  })
                  .catch((e) => {
                    console.error('Naver API asc failed:', e);
                    return { data: { items: [] } };
                  })
              : Promise.resolve({ data: { items: [] } }),

            // Only try direct scraping if we are in the packaged/Electron environment with PORT set
            process.env.PORT ? scrapeCoupangDirectly(query, process.env.PORT) : Promise.resolve([]),

            // Danawa Fallback
            useDanawa ? scrapeDanawaDirectly(query) : Promise.resolve([]),
          ]);

          let combinedItems = [
            ...(naverSim.data.items || []),
            ...(naverAsc.data.items || []),
            ...coupangDirectItems,
            ...danawaItems,
          ];

          // Deduplicate by link/productId to avoid redundant processing
          const uniqueItemsMap = new Map();
          for (const item of combinedItems) {
            const uniqueKey = item.productId || item.link;
            if (!uniqueItemsMap.has(uniqueKey)) {
              uniqueItemsMap.set(uniqueKey, item);
            }
          }
          combinedItems = Array.from(uniqueItemsMap.values());

          if (combinedItems.length > 0) {
            // Apply category-aware filtering pipeline
            const filterCtx = {
              category,
              productName: product.name,
              productSpec: product.spec,
              baseSearchName,
            };

            const validItems = combinedItems.filter((item: any) => evaluateCandidate(filterCtx, item.title).passed);

            if (validItems.length > 0) {
              // Determine baseline price (to remove outliers)
              const baselinePrice = product.currentPrice || product.purchasePrice || null;

              const saneItems = validItems.filter((item: any) => {
                const price = parseInt(item.lprice, 10);
                return !isPriceOutlier(price, baselinePrice);
              });
              const finalItems = saneItems.length > 0 ? saneItems : validItems;

              // Bucket by mall
              const naverCandidates = finalItems.filter(
                (item: any) =>
                  !item.mallName.toLowerCase().includes('쿠팡') &&
                  !item.mallName.toLowerCase().includes('coupang')
              );

              const coupangCandidates = finalItems.filter(
                (item: any) =>
                  item.mallName.toLowerCase().includes('쿠팡') ||
                  item.mallName.toLowerCase().includes('coupang')
              );

              naverCandidates.sort((a: any, b: any) => parseInt(a.lprice, 10) - parseInt(b.lprice, 10));
              coupangCandidates.sort((a: any, b: any) => parseInt(a.lprice, 10) - parseInt(b.lprice, 10));

              if (naverCandidates.length > 0) {
                naverPrice = parseInt(naverCandidates[0].lprice, 10);
                naverLink = naverCandidates[0].link;
                fetchSuccess = true;
              }

              if (coupangCandidates.length > 0) {
                coupangPrice = parseInt(coupangCandidates[0].lprice, 10);
                coupangLink = coupangCandidates[0].link;
                fetchSuccess = true;
              }
            }
          }
        } catch (naverError) {
          console.error(`Naver API error for query "${query}":`, naverError);
        }
      }
    }

    const updates: string[] = ['"lastCheckedAt" = $1'];
    const values: any[] = [new Date()];
    let paramIdx = 2;

    if (fetchSuccess) {
      if (naverPrice !== null) {
        updates.push(`"naverPrice" = $${paramIdx++}`);
        values.push(naverPrice);
      }
      if (naverLink !== null) {
        updates.push(`"naverLink" = $${paramIdx++}`);
        values.push(naverLink);
      }
      if (coupangPrice !== null) {
        updates.push(`"coupangPrice" = $${paramIdx++}`);
        values.push(coupangPrice);
      }
      if (coupangLink !== null) {
        updates.push(`"coupangLink" = $${paramIdx++}`);
        values.push(coupangLink);
      }
    }

    values.push(productId);
    const queryStr = `UPDATE "Product" SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`;

    const { rows: updatedRows } = await pool.query(queryStr, values);
    const updatedProduct = updatedRows[0];

    return NextResponse.json({ success: true, product: updatedProduct });
  } catch (error) {
    console.error('Search API Error:', error);
    return NextResponse.json({ error: 'Failed to search' }, { status: 500 });
  }
}
