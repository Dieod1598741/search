const cheerio = require('cheerio');
async function test() {
  const query = '한스킨 매직 타이트닝 모공 앰플 30ml';
  console.log('Searching Danawa for:', query);
  try {
    const res = await fetch('https://search.danawa.com/dSearch.php?query=' + encodeURIComponent(query), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
      }
    });
    console.log('Status:', res.status);
    const html = await res.text();
    const $ = cheerio.load(html);
    const items = $('.product_list .prod_main_info');
    console.log('Found', items.length, 'items on Danawa');
    items.each((i, el) => {
      if (i >= 5) return;
      const title = $(el).find('.prod_name a').text().trim();
      const price = $(el).find('.price_sect strong').text().trim();
      console.log('-', title, ':', price);
    });
  } catch (e) {
    console.error(e);
  }
}
test();
