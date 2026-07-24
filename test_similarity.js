function getBigrams(str) {
  const bigrams = new Set();
  for (let i = 0; i < str.length - 1; i++) {
    bigrams.add(str.slice(i, i + 2));
  }
  return bigrams;
}

function calculateSimilarity(query, title) {
  const q = query.replace(/\s+/g, '').toLowerCase();
  const t = title.replace(/\s+/g, '').toLowerCase();
  if (q.length < 2 || t.length < 2) return 0;
  
  const bq = getBigrams(q);
  const bt = getBigrams(t);
  
  let intersectionSize = 0;
  for (const b of bq) {
    if (bt.has(b)) intersectionSize++;
  }
  
  // Percentage of query bigrams found in title
  return intersectionSize / bq.size;
}

const target = "한스킨리얼컴플렉션히알루론핑크캡슐세럼50ml";
const candidates = [
  "한스킨 리얼컴플렉션 히알루론 스킨에센스 150ml",
  "한스킨 리얼컴플렉션 히알루론 릴리프 수분크림 50ml",
  "한스킨 리얼컴플렉션 히알루론 릴리프 워터 선크림 50ml",
  "한스킨 한스킨 리얼 컴플렉션 히알루론 릴리프 수분 크림 50ml 1개",
  "한스킨 리얼 컴플렉션 히알루론 핑크 캡슐 세럼 50ml",
  "[한스킨] 리얼 컴플렉션 히알루론 핑크 캡슐 세럼 50ml"
];

console.log("Full Target:");
candidates.forEach(c => {
  console.log(`${calculateSimilarity(target, c).toFixed(2)} - ${c}`);
});

const shortTarget = "핑크캡슐세럼 50ml";
console.log("\nShort Target:");
candidates.forEach(c => {
  console.log(`${calculateSimilarity(shortTarget, c).toFixed(2)} - ${c}`);
});
