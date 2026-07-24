import { NextResponse } from 'next/server';
import * as xlsx from 'xlsx';

export async function GET() {
  try {
    // Create a new workbook and worksheet
    const workbook = xlsx.utils.book_new();
    const headers = ['순번', '상품명', '규격', '바코드', '공급사', '매입가', '판매가', '특매그룹속성', '특매매입가', '특매판매가', '재고', '재고액'];
    
    // Add some example data
    const data = [
      headers,
      ['1', 'AHC 글루타 크림 50ml+에센스 20ml x 2', '', '8809759083744', '커넥트에이치', '21450', '33000', '', '0', '0', '0', '0'],
    ];

    const worksheet = xlsx.utils.aoa_to_sheet(data);
    
    // Adjust column widths
    worksheet['!cols'] = [
      { wch: 10 }, // 순번
      { wch: 40 }, // 이름
      { wch: 15 }, // 규격
      { wch: 20 }, // 바코드
      { wch: 15 }, // 현재가격
    ];

    xlsx.utils.book_append_sheet(workbook, worksheet, '화장품목록');

    // Generate buffer
    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    // Return the excel file
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Disposition': 'attachment; filename="product_template.xlsx"',
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    });
  } catch (error) {
    console.error('Failed to generate template:', error);
    return NextResponse.json({ error: 'Failed to generate template' }, { status: 500 });
  }
}
