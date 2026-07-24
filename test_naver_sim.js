const axios = require('axios');
const { PrismaClient } = require('@prisma/client');

function getBigrams(str) {
  const bigrams = new Set();
  for (let i = 0; i < str.length - 1; i++) {
    bigrams.add(str.slice(i, i + 2));
  }
  return bigrams;
}

function calculateSimilarity(query, title) {
  const q = query.replace(/\s+/g, '').toLowerCase();
  const t = title.replace(/\s+/g, '').toLowerCase().replace(/<[^>]*>?/gm, '');
  if (q.length < 2 || t.length < 2) return 0;
  
  const bq = getBigrams(q);
  const bt = getBigrams(t);
  
  let intersectionSize = 0;
  for (const b of bq) {
    if (bt.has(b)) intersectionSize++;
  }
  return intersectionSize / bq.size;
}

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
        display: 50,
        sort: 'sim'
      },
      headers: {
        'X-Naver-Client-Id': config['NAVER_CLIENT_ID'],
        'X-Naver-Client-Secret': config['NAVER_CLIENT_SECRET']
      }
    });

    response.data.items.forEach((item) => {
      const sim = calculateSimilarity(query, item.title);
      console.log(`[${sim.toFixed(2)}] ${item.title.replace(/<[^>]*>?/gm, '')} - ${item.lprice}`);
    });
  } catch (error) {
    console.error('API Error:', error.response ? error.response.data : error.message);
  } finally {
    await prisma.$disconnect();
  }
}

test();
