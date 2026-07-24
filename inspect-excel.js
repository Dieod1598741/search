const xlsx = require('xlsx');
const fs = require('fs');

try {
  const workbook = xlsx.readFile('./메디킹덤 화장품 상품리스트(20260715).xlsx');
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
  
  console.log("Total rows:", data.length);
  for(let i = 0; i < Math.min(5, data.length); i++) {
    console.log(`Row ${i}:`, data[i]);
  }
} catch(e) {
  console.error(e);
}
