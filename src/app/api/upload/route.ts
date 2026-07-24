import { NextRequest, NextResponse } from 'next/server';
import * as xlsx from 'xlsx';
import prisma from '@/lib/prisma';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    
    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Parse Excel file
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    
    // Convert to JSON (array of arrays to easily find columns)
    const data: any[][] = xlsx.utils.sheet_to_json(sheet, { header: 1 });
    
    // Identify columns based on exact headers or keywords
    const headers = data[0].map(h => String(h).trim());
    
    let nameIdx = headers.findIndex(h => h === '상품명' || h.includes('이름'));
    let specIdx = headers.findIndex(h => h === '규격');
    let barcodeIdx = headers.findIndex(h => h === '바코드');
    let supplierIdx = headers.findIndex(h => h === '공급사');
    let purchasePriceIdx = headers.findIndex(h => h === '매입가');
    let priceIdx = headers.findIndex(h => h === '판매가' || h.includes('현재가격'));
    let stockIdx = headers.findIndex(h => h === '재고');

    // Fallback if headers aren't clear (e.g. they uploaded a plain file)
    if (nameIdx === -1) nameIdx = 1; 
    if (priceIdx === -1) priceIdx = 6; 

    await prisma.product.deleteMany();
    const productsToInsert = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length === 0) continue;
      
      const name = row[nameIdx] ? String(row[nameIdx]).trim() : '';
      if (!name) continue;

      const currentPrice = row[priceIdx] ? parseInt(String(row[priceIdx]).replace(/[^0-9]/g, ''), 10) || 0 : 0;
      const purchasePrice = row[purchasePriceIdx] ? parseInt(String(row[purchasePriceIdx]).replace(/[^0-9]/g, ''), 10) || 0 : null;
      const stock = row[stockIdx] ? parseInt(String(row[stockIdx]).replace(/[^0-9]/g, ''), 10) || 0 : null;
      
      const spec = specIdx !== -1 && row[specIdx] ? String(row[specIdx]).trim() : null;
      const barcode = barcodeIdx !== -1 && row[barcodeIdx] ? String(row[barcodeIdx]).trim() : null;
      const supplier = supplierIdx !== -1 && row[supplierIdx] ? String(row[supplierIdx]).trim() : null;

      productsToInsert.push({
        name,
        spec,
        barcode,
        supplier,
        purchasePrice,
        currentPrice,
        stock
      });
    }

    await prisma.product.createMany({
      data: productsToInsert,
    });

    return NextResponse.json({ success: true, count: productsToInsert.length });
  } catch (error) {
    console.error('Upload Error:', error);
    return NextResponse.json({ error: 'Failed to process file' }, { status: 500 });
  }
}
