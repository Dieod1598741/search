import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import axios from 'axios';

// Naver keys will be fetched dynamically from the database

function getBigrams(str: string): Set<string> {
  const bigrams = new Set<string>();
  for (let i = 0; i < str.length - 1; i++) {
    bigrams.add(str.slice(i, i + 2));
  }
  return bigrams;
}

function calculateSimilarity(query: string, title: string): number {
  const q = query.replace(/\s+/g, '').toLowerCase();
  const t = title.replace(/\s+/g, '').toLowerCase().replace(/<[^>]*>?/gm, '');
  if (q.length < 2 || t.length < 2) return 0;
  
  const bq = getBigrams(q);
  const bt = getBigrams(t);
  
  let intersectionSize = 0;
  for (const b of bq) {
    if (bt.has(b)) intersectionSize++;
  }
  
  return intersectionSize / bq.size;
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

    // Option A: Combine product name and spec for higher accuracy
    const query = product.spec ? `${product.name} ${product.spec}` : product.name;
    
    // Fetch settings from database
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
      try {
        const response = await axios.get('https://openapi.naver.com/v1/search/shop.json', {
          params: {
            query: query,
            display: 50, // 50개까지 넓게 탐색하여 10위권 밖의 숨겨진 최저가 쿠팡 상품까지 찾아냅니다.
            sort: 'sim',
          },
          headers: {
            'X-Naver-Client-Id': NAVER_CLIENT_ID,
            'X-Naver-Client-Secret': NAVER_CLIENT_SECRET,
          }
        });

        fetchSuccess = true;

        if (response.data.items && response.data.items.length > 0) {
          
          // --- 묶음 상품 및 유사도 필터링 로직 ---
          const isOriginalBundle = /([2-9]개|[2-9]ea|1\+1|2\+1)/i.test(product.name) || (product.spec && /([2-9]개|[2-9]ea|1\+1|2\+1)/i.test(product.spec));
          
          // 1. 유사도 필터링 (검색어의 핵심 키워드가 제목에 75% 이상 포함되어야 함)
          const filterRelevance = (item: any) => {
            const cleanTitle = item.title.replace(/<[^>]*>?/gm, '');
            return calculateSimilarity(query, cleanTitle) >= 0.75;
          };

          // 2. 묶음 상품 필터링
          const filterBundle = (item: any) => {
            if (isOriginalBundle) return true; 
            const cleanTitle = item.title.replace(/<[^>]*>?/gm, '');
            if (/(증정|사은품|샘플|추가|덤)/.test(cleanTitle)) return true;
            return !/([2-9]개|[2-9]ea|1\+1|2\+1)/i.test(cleanTitle);
          };

          const relevantItems = response.data.items.filter(filterRelevance);
          const singlePieceItems = relevantItems.filter(filterBundle);
          
          // 단품이 하나도 없다면, 정확도 75% 이상인 묶음 상품이라도 가져옵니다. (사용자 수기 확인용)
          const validItems = singlePieceItems.length > 0 ? singlePieceItems : relevantItems;

          // 1. Naver Price (Non-Coupang)
          const naverCandidates = validItems.filter((item: any) => 
            !item.mallName.toLowerCase().includes('쿠팡') && 
            !item.mallName.toLowerCase().includes('coupang')
          );
          naverCandidates.sort((a: any, b: any) => parseInt(a.lprice, 10) - parseInt(b.lprice, 10));

          if (naverCandidates.length > 0) {
            naverPrice = parseInt(naverCandidates[0].lprice, 10);
            naverLink = naverCandidates[0].link;
          }
          // 2. Coupang Price (Via Naver API - Best Effort due to Coupang WAF)
          const coupangCandidates = validItems.filter((item: any) => 
            item.mallName.toLowerCase().includes('쿠팡') || 
            item.mallName.toLowerCase().includes('coupang')
          );
          coupangCandidates.sort((a: any, b: any) => parseInt(a.lprice, 10) - parseInt(b.lprice, 10));

          if (coupangCandidates.length > 0) {
            coupangPrice = parseInt(coupangCandidates[0].lprice, 10);
            coupangLink = coupangCandidates[0].link;
            console.log(`[Success] Found Coupang price via Naver API: ${coupangPrice}`);
          }
        }
      } catch (naverError) {
        console.error('Naver API error:', naverError);
      }
    }

    const updates: string[] = ['"lastCheckedAt" = $1'];
    const values: any[] = [new Date()];
    let paramIdx = 2;
    
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
