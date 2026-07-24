async function test() {
  try {
    const res = await fetch('https://www.coupang.com/vp/products/7458436423?itemId=19434730493&vendorItemId=95648642038', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
      }
    });
    console.log('Status Code:', res.status);
    const text = await res.text();
    if (text.includes('Access Denied') || text.includes('error')) {
      console.log('BLOCKED');
    } else {
      console.log('SUCCESS, length:', text.length);
    }
  } catch (e) {
    console.error(e);
  }
}
test();
