async function test() {
  try {
    const res = await fetch('https://fallcent.com/');
    console.log('Status Code:', res.status);
    const html = await res.text();
    if (html.includes('Cloudflare') || html.includes('cf-browser-verification')) {
      console.log('BLOCKED BY CLOUDFLARE');
    } else {
      console.log('HTML snippet:', html.substring(0, 300));
    }
  } catch (err) {
    console.error(err);
  }
}
test();
