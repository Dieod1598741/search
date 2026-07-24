const cheerio = require('cheerio');
async function test() {
  const query = '한스킨 매직 타이트닝 모공 앰플 30ml';
  console.log('Searching Coupang Mobile for:', query);
  try {
    const coupangResponse = await fetch('https://m.coupang.com/vm/search?q=' + encodeURIComponent(query), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9'
      }
    });
    console.log('Status Code:', coupangResponse.status);
    const html = await coupangResponse.text();
    console.log('HTML Length:', html.length);
    if (html.includes('Captcha') || html.includes('captcha') || html.includes('Access Denied')) {
      console.log('BLOCKED BY CAPTCHA OR WAF!');
    } else {
      const $ = cheerio.load(html);
      const items = $('.search-product');
      console.log('Found', items.length, 'items.');
      // print first snippet of body to see if it loaded react/vue
      console.log(html.substring(0, 500));
    }
  } catch (err) {
    console.error('Fetch error:', err.message);
  }
}
test();
