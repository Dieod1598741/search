import { NextRequest, NextResponse } from 'next/server';
import { fetchAggregatedCandidates } from '@/lib/scrapers';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const query = url.searchParams.get('query');

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 });
    }

    const combinedItems = await fetchAggregatedCandidates(query, {
      port: process.env.PORT,
      includeCoupang: Boolean(process.env.PORT),
    });

    // Sort by price ascending for fast human verification
    const candidates = combinedItems
      .sort((a, b) => parseInt(a.lprice, 10) - parseInt(b.lprice, 10))
      .slice(0, 30);

    return NextResponse.json({ success: true, candidates });
  } catch (error) {
    console.error('Candidates API Error:', error);
    return NextResponse.json({ error: 'Failed to fetch candidates' }, { status: 500 });
  }
}
