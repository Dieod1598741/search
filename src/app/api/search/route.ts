import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import axios from 'axios';

// --- Advanced Algorithm Helpers ---

// 1. Levenshtein Distance for robust similarity
function levenshtein(a: string, b: string): number {
  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) matrix[i][j] = matrix[i - 1][j - 1];
      else matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    }
  }
  return matrix[a.length][b.length];
}

function calculateSimilarity(query: string, title: string): number {
  const q = query.replace(/\s+/g, '').toLowerCase();
  const t = title.replace(/\s+/g, '').toLowerCase().replace(/<[^>]*>?/gm, '');
  const distance = levenshtein(q, t);
  const maxLength = Math.max(q.length, t.length);
  return maxLength === 0 ? 1 : 1 - (distance / maxLength);
}

// 2. Smart Unit Extraction (Cosmetics & Medicines)
function extractSpecs(text: string): string[] {
  const specs: string[] = [];
  const regex = /(\d+(?:\.\d+)?)\s*(mg|ml|g|oz|정|캡슐|매|장|팩|kg|l|개|ea)(?!\w|[가-힣])/gi;
  let match;
  while ((match = regex.exec(text)) !== null) {
    specs.push(match[0].replace(/\s+/g, '').toLowerCase());
  }
  return specs;
}

// 3. Conflict Detection
function hasConflictingSpec(originalSpecs: string[], title: string): boolean {
  const titleSpecs = extractSpecs(title);
  if (originalSpecs.length === 0) return false;
  
  for (const oSpec of originalSpecs) {
    const unitMatch = oSpec.match(/[a-z가-힣]+/i);
    if (!unitMatch) continue;
    const unit = unitMatch[0];
    
    // Check if the title has ANY spec with this unit
    const titleSpecsWithSameUnit = titleSpecs.filter(s => s.endsWith(unit));
    
    // If title has this unit, but the exact original spec is NOT present, it's conflicting!
    if (titleSpecsWithSameUnit.length > 0 && !titleSpecsWithSameUnit.includes(oSpec)) {
      return true;
    }
  }
  return false;
}

// 4. Outlier Detection
function isPriceOutlier(price: number, baselinePrice: number | null): boolean {
  if (!baselinePrice || baselinePrice === 0) return false;
  // If the found price is less than 20% or more than 300% of baseline, reject it.
  if (price < baselinePrice * 0.2 || price > baselinePrice * 3) {
    return true;
  }
  return false;
}

export async function POST(req: NextRequest) {
  try {
    const { productId } = await req.json();
    
    const { rows: productRows } = await pool.query('SELECT * FROM "Product" WHERE id = $1', [productId]);
    const product = productRows[0];

    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    if (product.isManualOverride) {
      return NextResponse.json({ 
        success: true, 
        product,
        note: 'Skipped automated search due to manual override'
      });
    }

    // --- Multi-stage Fallback Search Strategy ---
    const queries = [
      product.spec ? `${product.name} ${product.spec}` : product.name,
      product.barcode ? `${product.name} ${product.barcode}` : null,
      product.name
    ].filter(Boolean) as string[];
    
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

    if (NAVER_CLIENT_ID && NAVER_CLIENT_SECRET) {
      for (const query of queries) {
        if (fetchSuccess) break; // Stop if previous stage succeeded

        try {
          const response = await axios.get('https://openapi.naver.com/v1/search/shop.json', {
            params: {
              query: query,
              display: 100, // Maximized display to find deeply buried correct items
              sort: 'sim',
            },
            headers: {
              'X-Naver-Client-Id': NAVER_CLIENT_ID,
              'X-Naver-Client-Secret': NAVER_CLIENT_SECRET,
            }
          });

          if (response.data.items && response.data.items.length > 0) {
            
            // --- Advanced Filtering Logic ---
            const originalTitle = `${product.name} ${product.spec || ''}`;
            const originalSpecs = extractSpecs(originalTitle);
            
            // 1. Bundle keyword detection
            const bundleRegex = /(증정|사은품|샘플|덤|박스|세트|대용량|기획|x2|x3|1\+1|2\+1)/i;
            const naiveCountRegex = /([2-9]개|[2-9]ea)/i;
            const isOriginalBundle = bundleRegex.test(originalTitle) || naiveCountRegex.test(originalTitle);
            
            const filterBundle = (item: any) => {
              if (isOriginalBundle) return true; // If original is a bundle, accept everything and let spec check handle it
              const cleanTitle = item.title.replace(/<[^>]*>?/gm, '');
              
              // Only block explicit bundles. We let specs (like 100정 vs 10정) be handled by the conflict detector.
              if (bundleRegex.test(cleanTitle) || naiveCountRegex.test(cleanTitle)) {
                  // If it contains a bundle keyword, but the original spec explicitly had it, we wouldn't reach here (isOriginalBundle = true).
                  // But wait, "증정" or "샘플" usually means it's a promotion. We might want to allow promotions if it's the exact same spec.
                  // Let's be strict: if original is NOT a bundle, reject bundle results.
                  return false;
              }
              return true;
            };

            // 2. Spec Conflict Filtering (The core intelligence)
            const filterSpecConflict = (item: any) => {
              const cleanTitle = item.title.replace(/<[^>]*>?/gm, '');
              return !hasConflictingSpec(originalSpecs, cleanTitle);
            };

            // 3. Relevance Filtering
            const filterRelevance = (item: any) => {
              const cleanTitle = item.title.replace(/<[^>]*>?/gm, '');
              const similarity = calculateSimilarity(product.name, cleanTitle);
              // Require at least 30% Levenshtein similarity to the base product name to avoid completely random products
              return similarity >= 0.3;
            };

            // Apply filters
            let validItems = response.data.items.filter(filterRelevance).filter(filterSpecConflict);
            const nonBundleItems = validItems.filter(filterBundle);
            
            // Fallback: If stripping bundles leaves nothing, use validItems (which might include promotions)
            validItems = nonBundleItems.length > 0 ? nonBundleItems : validItems;

            if (validItems.length > 0) {
                // Determine baseline price (to remove outliers)
                const baselinePrice = product.currentPrice || product.purchasePrice || null;
                
                const filterOutliers = (item: any) => {
                    const price = parseInt(item.lprice, 10);
                    return !isPriceOutlier(price, baselinePrice);
                };
                
                const saneItems = validItems.filter(filterOutliers);
                const finalItems = saneItems.length > 0 ? saneItems : validItems; // Fallback to all if baseline breaks everything

                // Bucket by mall
                const naverCandidates = finalItems.filter((item: any) => 
                  !item.mallName.toLowerCase().includes('쿠팡') && 
                  !item.mallName.toLowerCase().includes('coupang')
                );
                
                const coupangCandidates = finalItems.filter((item: any) => 
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
    
    // We update even if values are null, IF fetchSuccess was true (meaning we found something but maybe only one mall)
    // Wait, if fetchSuccess is false, it means we found NOTHING across all queries. We just update lastCheckedAt.
    if (fetchSuccess) {
      if (naverPrice !== null) { updates.push(`"naverPrice" = $${paramIdx++}`); values.push(naverPrice); }
      if (naverLink !== null) { updates.push(`"naverLink" = $${paramIdx++}`); values.push(naverLink); }
      if (coupangPrice !== null) { updates.push(`"coupangPrice" = $${paramIdx++}`); values.push(coupangPrice); }
      if (coupangLink !== null) { updates.push(`"coupangLink" = $${paramIdx++}`); values.push(coupangLink); }
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
