const cheerio = require('cheerio');
async function test() {
  try {
    const res = await fetch('https://fallcent.com/search?keyword=' + encodeURIComponent('한스킨 매직 타이트닝 모공 앰플 30ml'));
    const html = await res.text();
    console.log('Status Code:', res.status);
    
    // Check if there are any products
    const $ = cheerio.load(html);
    console.log('Title:', $('title').text());
    console.log('Body length:', $('body').html()?.length);
    
    // Try to find any price elements or links
    let items = [];
    $('*').each((i, el) => {
      const text = $(el).text();
      if (text.includes('11,330') || text.includes('11330')) {
        console.log('Found 11330 inside tag:', el.tagName, 'class:', $(el).attr('class'));
      }
    });
    
  } catch (err) {
    console.error(err);
  }
}
test();
