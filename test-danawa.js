const { chromium } = require('playwright');

async function testDanawa() {
  console.log("Launching playwright...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  const query = "AHC 글루타 크림 50ml";
  const url = `https://search.danawa.com/dSearch.php?k1=${encodeURIComponent(query)}`;
  
  console.log("Navigating to:", url);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  
  // Wait for product list
  await page.waitForSelector('.product_list', { timeout: 5000 }).catch(() => console.log("Timeout waiting for product_list"));
  
  const html = await page.content();
  const fs = require('fs');
  fs.writeFileSync('danawa.html', html);
  console.log("Saved danawa.html");
  
  await browser.close();
}

testDanawa();
