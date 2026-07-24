import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET() {
  try {
    const { rows: settings } = await pool.query('SELECT * FROM "Setting"');
    const config = settings.reduce((acc: Record<string, string>, curr) => {
      acc[curr.id] = curr.value;
      return acc;
    }, {});
    
    return NextResponse.json({ success: true, config });
  } catch (error) {
    console.error('Settings GET Error:', error);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { naverClientId, naverClientSecret } = await req.json();

    if (naverClientId !== undefined) {
      await pool.query(
        `INSERT INTO "Setting" (id, value) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value`,
        ['NAVER_CLIENT_ID', naverClientId]
      );
    }

    if (naverClientSecret !== undefined) {
      await pool.query(
        `INSERT INTO "Setting" (id, value) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value`,
        ['NAVER_CLIENT_SECRET', naverClientSecret]
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Settings POST Error:', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
