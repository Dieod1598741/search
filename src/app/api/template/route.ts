import { NextRequest, NextResponse } from 'next/server';
import * as xlsx from 'xlsx';
import { CATEGORY_META, normalizeCategory, ProductCategory } from '@/lib/categories';

const TEMPLATE_EXAMPLES: Record<ProductCategory, string[][]> = {
  COSMETICS: [
    ['1', '토니모리 프리미엄RX 제비집 아이크림', '70ml', '8806194041234', '토니모리', '18000', '29000', '', '0', '0', '0', '0'],
    ['2', 'AHC 글루타 크림 50ml+에센스 20ml', '', '8809759083744', '커넥트에이치', '21450', '33000', '', '0', '0', '0', '0'],
  ],
  HEALTH_FOOD: [
    ['1', '종근당건강 락토핏 골드', '50포', '8809012345678', '종근당건강', '9500', '13900', '', '0', '0', '0', '0'],
    ['2', '고려은단 비타민C 1000', '120정', '8809098765432', '고려은단', '11000', '15500', '', '0', '0', '0', '0'],
  ],
  FOOD: [
    ['1', '동원 라이트스탠다드 참치', '85g 12캔', '8801047123456', '동원F&B', '14000', '18900', '', '0', '0', '0', '0'],
    ['2', '농심 신라면', '120g 5입', '8801043014830', '농심', '3600', '4600', '', '0', '0', '0', '0'],
  ],
};

export async function GET(req: NextRequest) {
  try {
    const category = normalizeCategory(req.nextUrl.searchParams.get('category'));
    const meta = CATEGORY_META[category];

    const workbook = xlsx.utils.book_new();
    const headers = ['순번', '상품명', '규격', '바코드', '공급사', '매입가', '판매가', '특매그룹속성', '특매매입가', '특매판매가', '재고', '재고액'];

    const data = [headers, ...TEMPLATE_EXAMPLES[category]];
    const worksheet = xlsx.utils.aoa_to_sheet(data);

    worksheet['!cols'] = [
      { wch: 8 },  // 순번
      { wch: 42 }, // 상품명
      { wch: 16 }, // 규격
      { wch: 18 }, // 바코드
      { wch: 16 }, // 공급사
      { wch: 12 }, // 매입가
      { wch: 12 }, // 판매가
    ];

    xlsx.utils.book_append_sheet(workbook, worksheet, meta.excelSheetName);

    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Disposition': `attachment; filename="${meta.templateFileName}"`,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    });
  } catch (error) {
    console.error('Failed to generate template:', error);
    return NextResponse.json({ error: 'Failed to generate template' }, { status: 500 });
  }
}
