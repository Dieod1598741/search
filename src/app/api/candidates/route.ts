import { NextRequest, NextResponse } from 'next/server';
import { fetchAggregatedCandidates } from '@/lib/scrapers';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const query = url.searchParams.get('query');

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 });
    }

    const { items, blockedChannels } = await fetchAggregatedCandidates(query, {
      port: process.env.PORT,
      includeSessionChannels: Boolean(process.env.PORT),
    });

    const candidates = items
      .sort((a, b) => parseInt(a.lprice, 10) - parseInt(b.lprice, 10))
      .slice(0, 30);

    return NextResponse.json({ success: true, candidates, blockedChannels });
  } catch (error) {
    console.error('Candidates API Error:', error);
    return NextResponse.json({ error: 'Failed to fetch candidates' }, { status: 500 });
  }
}
