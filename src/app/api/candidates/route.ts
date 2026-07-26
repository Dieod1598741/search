import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import axios from 'axios';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const query = url.searchParams.get('query');

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 });
    }

    const { rows: settings } = await pool.query('SELECT * FROM "Setting"');
    const config = settings.reduce((acc: Record<string, string>, curr) => {
      acc[curr.id] = curr.value;
      return acc;
    }, {});
    
    const NAVER_CLIENT_ID = config['NAVER_CLIENT_ID'] || '';
    const NAVER_CLIENT_SECRET = config['NAVER_CLIENT_SECRET'] || '';

    if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
      return NextResponse.json({ error: 'Naver API credentials not configured' }, { status: 500 });
    }

    // Fetch both similarity and price-ascending for a broader candidate list
    const [naverSim, naverAsc] = await Promise.all([
      axios.get('https://openapi.naver.com/v1/search/shop.json', {
        params: { query: query, display: 20, sort: 'sim' },
        headers: { 'X-Naver-Client-Id': NAVER_CLIENT_ID, 'X-Naver-Client-Secret': NAVER_CLIENT_SECRET }
      }).catch(e => { console.error('Naver API sim failed:', e); return { data: { items: [] } }; }),
      
      axios.get('https://openapi.naver.com/v1/search/shop.json', {
        params: { query: query, display: 20, sort: 'asc' },
        headers: { 'X-Naver-Client-Id': NAVER_CLIENT_ID, 'X-Naver-Client-Secret': NAVER_CLIENT_SECRET }
      }).catch(e => { console.error('Naver API asc failed:', e); return { data: { items: [] } }; })
    ]);

    let combinedItems = [...(naverSim.data.items || []), ...(naverAsc.data.items || [])];

    // Deduplicate by link/productId
    const uniqueItemsMap = new Map();
    for (const item of combinedItems) {
        const uniqueKey = item.productId || item.link;
        if (!uniqueItemsMap.has(uniqueKey)) {
            uniqueItemsMap.set(uniqueKey, item);
        }
    }
    
    // Sort by price (ascending) as a default useful view for humans
    const candidates = Array.from(uniqueItemsMap.values())
      .sort((a: any, b: any) => parseInt(a.lprice, 10) - parseInt(b.lprice, 10))
      .slice(0, 30); // Limit to top 30 unique candidates

    return NextResponse.json({ success: true, candidates });
  } catch (error) {
    console.error('Candidates API Error:', error);
    return NextResponse.json({ error: 'Failed to fetch candidates' }, { status: 500 });
  }
}
