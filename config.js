'use strict';

// 从商品标题抽取「配置指纹」：CPU / GPU / 内存 / 硬盘
// 慢慢买标题里同一配置有大量写法（16G 1T / 16GB 512GB / 16+500G / 32G+1TB），
// 必须归一化，否则不同配置的价格会被混在一起算"最低价"。
function configKey(name) {
  const t = String(name || '')
    .replace(/[＋]/g, '+')
    .replace(/[／\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // ---- CPU ----
  let cpu = '';
  const cpuPats = [
    [/Ultra\s*([579])[-\s]?(\d{3})H?/i, (m) => `U${m[1]}-${m[2]}`],
    [/\bAI\s*9[\s-]*H\s*(\d{3})/i, (m) => `AI9-${m[1]}`],
    [/\bAI\s*5[\s-]*H\s*(\d{3})/i, (m) => `AI5-${m[1]}`],
    [/\bR9[-\s]*(?:H\s*)?(\d{3,4}[A-Z]*)/i, (m) => `R9-${m[1]}`],
    [/\bR7[-\s]*(?:H\s*)?(\d{3,4}[A-Z]*)/i, (m) => `R7-${m[1]}`],
    [/\bR5[-\s]*(?:H\s*)?(\d{3,4}[A-Z]*)/i, (m) => `R5-${m[1]}`],
    [/\bi9[-\s]?(\d{4,5}[A-Z]*)/i, (m) => `i9-${m[1]}`],
    [/\bi7[-\s]?(\d{4,5}[A-Z]*)/i, (m) => `i7-${m[1]}`],
    [/\bi5[-\s]?(\d{4,5}[A-Z]*)/i, (m) => `i5-${m[1]}`],
    [/\bCore\s*([579])[-\s]?(\d{3})/i, (m) => `Core${m[1]}-${m[2]}`],
  ];
  for (const [re, fn] of cpuPats) {
    const m = t.match(re);
    if (m) { cpu = fn(m).replace(/^(\w+-\d{3})H$/, '$1'); break; }
  }

  // ---- GPU ----
  let gpu = '';
  const rtx = t.match(/RTX[\s-]*(\d{4})\s*(Ti|SUPER)?/i);
  if (rtx) gpu = `RTX${rtx[1]}${(rtx[2] || '').toUpperCase().replace(/\s/g, '')}`;
  else if (/核显|集显|780M|880M|核芯/.test(t)) gpu = '核显';
  else {
    const gtx = t.match(/GTX\s*(\d{4})/i);
    if (gtx) gpu = `GTX${gtx[1]}`;
  }

  // ---- 内存 + 硬盘 ----
  let ram = '';
  let ssd = '';

  // "12+500G" / "16G+1TB" / "32GB+1TB"
  const pairPlus = t.match(
    /(\d{1,3})\s*(?:G(?:B)?)?\s*\+\s*(?:(\d{3,4})\s*G(?:B)?|(\d)\s*T(?:B)?)/i
  );
  // "16G 1T" / "16GB 512GB" / "24G 512G"
  const pairSpace = t.match(
    /(\d{1,3})\s*G(?:B)?\s+(?:(\d{3,4})\s*G(?:B)?|(\d)\s*T(?:B)?)/i
  );
  const pair = pairPlus || pairSpace;
  if (pair) {
    ram = `${pair[1]}G`;
    if (pair[2]) ssd = `${pair[2]}G`;
    else if (pair[3]) ssd = `${pair[3]}TB`;
  } else {
    const tb = t.match(/\b(1|2|4|8)\s*TB\b/i);
    const tOnly = t.match(/\b(1|2|4|8)\s*T\b(?![a-zA-Z])/i);
    const gb = t.match(/\b(512|500|256|128)\s*G\b/i);
    if (tb) ssd = `${tb[1]}TB`;
    else if (tOnly) ssd = `${tOnly[1]}TB`;
    else if (gb) ssd = `${gb[1]}G`;

    const ramM = t.match(/(\d{1,3})\s*G(?:B)?\b/i);
    if (ramM) ram = `${ramM[1]}G`;
  }

  const parts = [cpu, gpu, ram, ssd].filter(Boolean);
  return parts.length ? parts.join(' / ') : '未知配置';
}

module.exports = { configKey };
