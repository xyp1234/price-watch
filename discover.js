const { fetchSearch } = require('./source');
const fs = require('fs');

const KEYWORDS = [
  '拯救者R7000P', '拯救者R7000P 2026', '机械革命极光Pro', '机械革命无畏Pro',
  '宏碁暗影骑士', '华硕天选5', '天选6', 'RTX 5060 游戏本', 'RTX 5050 游戏本',
  '蛟龙 笔记本', '旅行者 笔记本', '神舟 游戏本', '机械师 游戏本', '雷神 游戏本',
  '机械革命无界14X', '联想来酷斗战者', 'R7 8845H 笔记本', 'RTX 5060 笔记本',
  '无畏Pro 14', '酷睿Ultra 5 笔记本', '游戏本 32G', '笔记本 32G 1T',
];

const LO = 2800, HI = 4500;

(async () => {
  const rows = [];
  for (const kw of KEYWORDS) {
    try {
      const { items } = await fetchSearch(kw);
      let kept = 0;
      for (const it of items) {
        if (it.price < LO || it.price > HI) continue;
        if (/已结束/.test(it.priceText)) continue;
        rows.push({ kw, ...it });
        kept++;
      }
      console.error(`${kw.padEnd(20)} total=${String(items.length).padStart(2)} in-range=${kept}`);
    } catch (e) {
      console.error(`${kw}: ERR ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 1300));
  }

  const seen = new Set();
  const uniq = rows.filter((r) => {
    const k = r.name.replace(/[\s：:，,。、（）()【】\[\]]/g, '').slice(0, 45) + '|' + r.price + '|' + r.platform;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  uniq.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  fs.writeFileSync('discovery.json', JSON.stringify(uniq, null, 2), 'utf8');
  const lines = uniq.map(
    (r) =>
      `${(r.date || '??').padEnd(12)} ${String(r.price).padStart(8)}  ${(r.platform || '?').padEnd(4)}  ${(r.tags.filter(Boolean).join('/') || '-').padEnd(14)}  ${r.name.slice(0, 55)}`
  );
  fs.writeFileSync('discovery.txt', lines.join('\n'), 'utf8');
  console.error(`\ntotal in-range rows: ${rows.length}, unique: ${uniq.length}`);
})();
