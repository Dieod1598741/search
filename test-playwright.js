const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { chromium } = require('playwright');

async function testSearch() {
  try {
    const products = await prisma.product.findMany({ take: 1 });
    if (products.length === 0) {
      console.log("No products to test");
      return;
    }
    const product = products[0];
    const query = product.spec ? `${product.name} ${product.spec}` : product.name;
    console.log("Query:", query);
    
    console.log("Launching playwright...");
    const browser = await chromium.launch({ headless: true });
    console.log("Browser launched");
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
      locale: 'ko-KR',
    });
    const page = await context.newPage();
    
    const coupangUrl = `https://www.coupang.com/np/search?q=${encodeURIComponent(query)}`;
    console.log("Navigating to:", coupangUrl);
    await page.goto(coupangUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    console.log("Navigation complete");
    await browser.close();
  } catch (e) {
    console.error("Test failed:", e.message);
  } finally {
    await prisma.$disconnect();
  }
}

testSearch();
