const axios = require('axios');
const { PrismaClient } = require('@prisma/client');

async function test() {
  const prisma = new PrismaClient();
  const settings = await prisma.setting.findMany();
  const config = settings.reduce((acc, curr) => {
    acc[curr.id] = curr.value;
    return acc;
  }, {});

  const query = "한스킨리얼컴플렉션히알루론핑크캡슐세럼50ml";
  
  try {
    const response = await axios.get('https://openapi.naver.com/v1/search/shop.json', {
      params: {
        query: query,
        display: 10,
        sort: 'asc' // lowest price first, same as the app
      },
      headers: {
        'X-Naver-Client-Id': config['NAVER_CLIENT_ID'],
        'X-Naver-Client-Secret': config['NAVER_CLIENT_SECRET']
      }
    });

    console.log(`Search: ${query}`);
    console.log(`Total results: ${response.data.total}`);
    console.log('Top 5 results:');
    response.data.items.slice(0, 5).forEach((item, idx) => {
      console.log(`[${idx+1}] ${item.title.replace(/<[^>]*>?/gm, '')} - ${item.lprice}원 (${item.mallName})`);
    });
  } catch (error) {
    console.error('API Error:', error.response ? error.response.data : error.message);
  } finally {
    await prisma.$disconnect();
  }
}

test();
