import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';

export async function POST(req: NextRequest) {
  try {
    const { channel } = await req.json();
    const safeChannel = channel === 'coupang' ? 'coupang' : 'naver';

    if (!process.env.PORT) {
      return NextResponse.json(
        {
          success: false,
          error: '데스크톱 앱(SEARCH.exe) 환경에서만 내장 세션 연결 창을 열 수 있습니다.',
        },
        { status: 400 }
      );
    }

    await axios.get(`http://localhost:${process.env.PORT}/api/internal/open-session?channel=${safeChannel}`, {
      timeout: 5000,
    });

    return NextResponse.json({ success: true, channel: safeChannel });
  } catch (error) {
    console.error('Open session error:', error);
    return NextResponse.json({ success: false, error: '세션 창을 여는 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
