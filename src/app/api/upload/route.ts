import { NextRequest, NextResponse } from 'next/server';
import * as xlsx from 'xlsx';
import pool, { ensureProductSchema } from '@/lib/db';
import { normalizeCategory } from '@/lib/categories';

export async function POST(req: NextRequest) {
  try {
    await ensureProductSchema();

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const category = normalizeCategory(formData.get('category') as string | null);
    const mode = (formData.get('mode') as string | null) === 'append' ? 'append' : 'replace';

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
    if (!data || data.length === 0) {
      return NextResponse.json({ error: '엑셀 파일에 데이터가 없습니다.' }, { status: 400 });
    }

    // Identify columns based on exact headers or keywords
    const headers = (data[0] || []).map(h => String(h ?? '').trim());

    let nameIdx = headers.findIndex(h => h === '상품명' || h.includes('이름') || h.includes('품명'));
    const specIdx = headers.findIndex(h => h === '규격' || h.includes('용량') || h.includes('수량'));
    const barcodeIdx = headers.findIndex(h => h === '바코드');
    const supplierIdx = headers.findIndex(h => h === '공급사' || h.includes('거래처') || h.includes('제조사'));
    const purchasePriceIdx = headers.findIndex(h => h === '매입가');
    let priceIdx = headers.findIndex(h => h === '판매가' || h.includes('현재가격') || h.includes('현재 판매가'));
    const stockIdx = headers.findIndex(h => h === '재고');

    // Fallback if headers aren't clear (e.g. they uploaded a plain file)
    if (nameIdx === -1) nameIdx = 1;
    if (priceIdx === -1) priceIdx = 6;

    const productsToInsert: any[][] = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length === 0) continue;

      const name = row[nameIdx] ? String(row[nameIdx]).trim() : '';
      if (!name) continue;

      const currentPrice = row[priceIdx] ? parseInt(String(row[priceIdx]).replace(/[^0-9]/g, ''), 10) || 0 : 0;
      const purchasePrice =
        purchasePriceIdx !== -1 && row[purchasePriceIdx]
          ? parseInt(String(row[purchasePriceIdx]).replace(/[^0-9]/g, ''), 10) || 0
          : null;
      const stock =
        stockIdx !== -1 && row[stockIdx]
          ? parseInt(String(row[stockIdx]).replace(/[^0-9]/g, ''), 10) || 0
          : null;

      const spec = specIdx !== -1 && row[specIdx] ? String(row[specIdx]).trim() : null;
      const barcode = barcodeIdx !== -1 && row[barcodeIdx] ? String(row[barcodeIdx]).trim() : null;
      const supplier = supplierIdx !== -1 && row[supplierIdx] ? String(row[supplierIdx]).trim() : null;

      productsToInsert.push([
        name,
        spec,
        barcode,
        supplier,
        purchasePrice,
        currentPrice,
        stock,
        category,
      ]);
    }

    if (productsToInsert.length === 0) {
      return NextResponse.json({ error: '유효한 상품 행을 찾지 못했습니다. 엑셀 양식을 확인해주세요.' }, { status: 400 });
    }

    // Only replace rows within the selected category (never touch other categories!)
    if (mode === 'replace') {
      await pool.query('DELETE FROM "Product" WHERE category = $1', [category]);
    }

    // Insert new records in chunks to stay well under PostgreSQL parameter limits
    const CHUNK_SIZE = 500;
    for (let start = 0; start < productsToInsert.length; start += CHUNK_SIZE) {
      const chunk = productsToInsert.slice(start, start + CHUNK_SIZE);
      const valuesStr: string[] = [];
      const params: any[] = [];
      let idx = 1;

      for (const p of chunk) {
        valuesStr.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`);
        params.push(...p);
      }

      const query = `INSERT INTO "Product" (name, spec, barcode, supplier, "purchasePrice", "currentPrice", stock, category) VALUES ${valuesStr.join(', ')}`;
      await pool.query(query, params);
    }

    return NextResponse.json({ success: true, count: productsToInsert.length, category, mode });
  } catch (error) {
    console.error('Upload Error:', error);
    return NextResponse.json({ error: 'Failed to process file' }, { status: 500 });
  }
}
