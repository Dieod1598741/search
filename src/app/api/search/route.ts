import { NextRequest, NextResponse } from 'next/server';
import pool, { ensureProductSchema } from '@/lib/db';
import { normalizeCategory } from '@/lib/categories';
import { evaluateCandidate, isPriceOutlier } from '@/lib/searchFilters';
import { fetchAggregatedCandidates } from '@/lib/scrapers';

export async function POST(req: NextRequest) {
  try {
    await ensureProductSchema();
    const { productId, customKeyword } = await req.json();

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

    let onlineLowestPrice: number | null = null;
    let onlineLowestLink: string | null = null;
    let coupangPrice: number | null = null;
    let coupangLink: string | null = null;
    let fetchSuccess = false;

    for (const query of queries) {
      if (fetchSuccess && onlineLowestPrice !== null && coupangPrice !== null) break;

      try {
        const combinedItems = await fetchAggregatedCandidates(query, {
          port: process.env.PORT,
          includeCoupang: Boolean(process.env.PORT),
        });

        if (combinedItems.length > 0) {
          const filterCtx = {
            category,
            productName: product.name,
            productSpec: product.spec,
            baseSearchName,
          };

          const validItems = combinedItems.filter((item) => evaluateCandidate(filterCtx, item.title).passed);

          if (validItems.length > 0) {
            const baselinePrice = product.currentPrice || product.purchasePrice || null;

            const saneItems = validItems.filter((item) => {
              const price = parseInt(item.lprice, 10);
              return !isPriceOutlier(price, baselinePrice);
            });
            const finalItems = saneItems.length > 0 ? saneItems : validItems;

            // Bucket by mall: aggregated price-comparison sites (Enuri/Danawa) vs direct Coupang
            const onlineCandidates = finalItems.filter(
              (item) =>
                !item.mallName.toLowerCase().includes('쿠팡') &&
                !item.mallName.toLowerCase().includes('coupang')
            );

            const coupangCandidates = finalItems.filter(
              (item) =>
                item.mallName.toLowerCase().includes('쿠팡') ||
                item.mallName.toLowerCase().includes('coupang')
            );

            onlineCandidates.sort((a, b) => parseInt(a.lprice, 10) - parseInt(b.lprice, 10));
            coupangCandidates.sort((a, b) => parseInt(a.lprice, 10) - parseInt(b.lprice, 10));

            if (onlineCandidates.length > 0) {
              const bestPrice = parseInt(onlineCandidates[0].lprice, 10);
              if (onlineLowestPrice === null || bestPrice < onlineLowestPrice) {
                onlineLowestPrice = bestPrice;
                onlineLowestLink = onlineCandidates[0].link;
              }
              fetchSuccess = true;
            }

            if (coupangCandidates.length > 0) {
              const bestCoupang = parseInt(coupangCandidates[0].lprice, 10);
              if (coupangPrice === null || bestCoupang < coupangPrice) {
                coupangPrice = bestCoupang;
                coupangLink = coupangCandidates[0].link;
              }
              fetchSuccess = true;
            }
          }
        }
      } catch (searchError) {
        console.error(`Search error for query "${query}":`, searchError);
      }
    }

    const updates: string[] = ['"lastCheckedAt" = $1'];
    const values: any[] = [new Date()];
    let paramIdx = 2;

    if (fetchSuccess) {
      if (onlineLowestPrice !== null) {
        updates.push(`"naverPrice" = $${paramIdx++}`);
        values.push(onlineLowestPrice);
      }
      if (onlineLowestLink !== null) {
        updates.push(`"naverLink" = $${paramIdx++}`);
        values.push(onlineLowestLink);
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
