const axios = require('axios');
const cheerio = require('cheerio');

async function testNaverScrape(query) {
  try {
    const url = `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(query)}`;
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
      }
    });
    
    const $ = cheerio.load(data);
    const nextData = $('#__NEXT_DATA__').html();
    
    if (nextData) {
        console.log("Found __NEXT_DATA__");
        const json = JSON.parse(nextData);
        // Let's try to find products
        const products = json.props.pageProps.initialState.products.list || [];
        if (products.length > 0) {
            console.log("First product:", products[0].item.productTitle, products[0].item.price, products[0].item.adcrUrl);
        } else {
             console.log("No products found in NEXT_DATA");
        }
    } else {
        console.log("No __NEXT_DATA__ found, might need DOM parsing");
    }
  } catch(e) {
    console.error(e.message);
  }
}

testNaverScrape('센트룸 멀티비타민');
