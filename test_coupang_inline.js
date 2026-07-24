const cheerio = require('cheerio');
async function test() {
  const query = '한스킨 매직 타이트닝 모공 앰플 30ml';
  console.log('Searching Coupang for:', query);
  try {
    const coupangResponse = await fetch('https://www.coupang.com/np/search?q=' + encodeURIComponent(query), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      }
    });
    console.log('Status Code:', coupangResponse.status);
    const html = await coupangResponse.text();
    console.log('HTML Length:', html.length);
    if (html.includes('Captcha') || html.includes('captcha') || html.includes('Access Denied')) {
      console.log('BLOCKED BY CAPTCHA OR WAF!');
    } else {
      const $ = cheerio.load(html);
      const items = $('.search-product-list .search-product');
      console.log('Found', items.length, 'items.');
      items.each((i, el) => {
        if (i >= 3) return;
        console.log('-', $(el).find('.name').text().trim(), ':', $(el).find('.price-value').text().trim());
      });
    }
  } catch (err) {
    console.error('Fetch error:', err.message);
  }
}
test();
