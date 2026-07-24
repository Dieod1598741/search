const xlsx = require('xlsx');

async function testUpload() {
  try {
    const workbook = xlsx.readFile('./메디킹덤 화장품 상품리스트(20260715).xlsx');
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
    
    const headers = data[0].map(h => String(h).trim());
    
    let nameIdx = headers.findIndex(h => h === '상품명' || h.includes('이름'));
    let specIdx = headers.findIndex(h => h === '규격');
    let barcodeIdx = headers.findIndex(h => h === '바코드');
    let supplierIdx = headers.findIndex(h => h === '공급사');
    let purchasePriceIdx = headers.findIndex(h => h === '매입가');
    let priceIdx = headers.findIndex(h => h === '판매가' || h.includes('현재가격'));
    let stockIdx = headers.findIndex(h => h === '재고');

    if (nameIdx === -1) nameIdx = 1; 
    if (priceIdx === -1) priceIdx = 6; 

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
    
    console.log(`Parsed ${productsToInsert.length} products`);
    console.log("First product:", productsToInsert[0]);
    console.log("Last product:", productsToInsert[productsToInsert.length - 1]);
    
    // Now try to insert into DB
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    
    await prisma.product.deleteMany();
    await prisma.product.createMany({
      data: productsToInsert,
    });
    console.log("DB Insert successful");
    
  } catch(e) {
    console.error("Test Error:", e);
  }
}

testUpload();
