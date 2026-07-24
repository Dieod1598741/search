import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET() {
  try {
    const settings = await prisma.setting.findMany();
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
      await prisma.setting.upsert({
        where: { id: 'NAVER_CLIENT_ID' },
        update: { value: naverClientId },
        create: { id: 'NAVER_CLIENT_ID', value: naverClientId }
      });
    }

    if (naverClientSecret !== undefined) {
      await prisma.setting.upsert({
        where: { id: 'NAVER_CLIENT_SECRET' },
        update: { value: naverClientSecret },
        create: { id: 'NAVER_CLIENT_SECRET', value: naverClientSecret }
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Settings POST Error:', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
