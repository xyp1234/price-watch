'use strict';
const fs = require('fs');
const path = require('path');
const { fetchSearch } = require('./source');
const { configKey } = require('./config');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA, 'state.json');
const HIST_FILE = path.join(DATA, 'history.jsonl');
const ALERT_FILE = path.join(DATA, 'alerts.jsonl');
const CSV_FILE = path.join(DATA, 'prices.csv');
const REPORT = path.join(ROOT, 'report.md');

const LOW_TAGS = ['历史新低', '历史最低', '30天新低', '60天新低', '90天新低', '180天新低'];
const DAY = 864e5;
const SEED = process.argv.includes('--seed');   // 首次建基线: 只记录不告警
const FRESH_DAYS = 3;                            // 只把最近 N 天的价格事件视为"新"

function ensureDirs() {
  fs.mkdirSync(DATA, { recursive: true });
}
function readJSON(f, fallback) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return fallback; }
}
function appendLine(f, obj) {
  fs.appendFileSync(f, JSON.stringify(obj) + '\n', 'utf8');
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function collectProduct(p) {
  const seen = new Map();
  const patterns = (p.match || []).map((s) => new RegExp(s, 'i'));
  for (const kw of p.keywords) {
    try {
      const { items } = await fetchSearch(kw);
      for (const it of items) {
        if (it.price < p.min || it.price > p.max) continue;
        if (!patterns.some((re) => re.test(it.name))) continue;
        const key = it.baoliaoUrl || `${it.name}|${it.price}|${it.date}`;
        if (!seen.has(key)) seen.set(key, { ...it, keyword: kw });
      }
    } catch (e) {
      console.error(`  ! ${p.id} / ${kw}: ${e.message}`);
    }
    await sleep(1200);
  }
  return [...seen.values()];
}

function dateToTs(d) {
  // "10-21 22:00" -> 2026-10-21 22:00 (assume current year, handle Dec->Jan)
  const m = String(d).match(/(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const now = new Date();
  let year = now.getFullYear();
  const mo = +m[1] - 1;
  if (mo > now.getMonth() + 1) year -= 1; // Dec item seen in Jan
  return new Date(year, mo, +m[2], +m[3], +m[4]).getTime();
}

async function main() {
  const cfg = readJSON(path.join(ROOT, 'watch.json'), null);
  if (!cfg) throw new Error('watch.json not found');
  ensureDirs();
  const state = readJSON(STATE_FILE, { products: {}, alertsSent: [] });
  const now = new Date().toISOString();

  const allAlerts = [];
  const reportRows = [];

  for (const p of cfg.products) {
    const items = await collectProduct(p);
    const st = state.products[p.id] || { seen: {}, lowestEver: null, lowestEverAt: null, lowestByConfig: {}, firstRun: now };
    if (!st.lowestByConfig) st.lowestByConfig = {};
    const fresh = [];
    const freshTs = Date.now() - FRESH_DAYS * DAY;

    for (const it of items) {
      const key = it.baoliaoUrl || `${it.name}|${it.price}|${it.date}`;
      const ts = dateToTs(it.date);
      const ckey = configKey(it.name);
      const isNew = !st.seen[key];
      if (isNew) {
        st.seen[key] = { price: it.price, date: it.date, ts, platform: it.platform, name: it.name, tags: it.tags, config: ckey, firstSeen: now };
        appendLine(HIST_FILE, { ts: now, product: p.id, productName: p.name, config: ckey, price: it.price, date: it.date, platform: it.platform, name: it.name, tags: it.tags, priceText: it.priceText, keyword: it.keyword });
        if (!SEED) fresh.push({ ...it, key, ts, config: ckey });
      }
      // 型号级最低价：不论有没有标签都参与
      if (!st.lowestEver || it.price < st.lowestEver) {
        st.lowestEver = it.price;
        st.lowestEverAt = it.date;
      }
      // 配置级最低价（不同配置不能混比）
      const lc = st.lowestByConfig[ckey];
      if (!lc || it.price < lc.price) st.lowestByConfig[ckey] = { price: it.price, date: it.date };
      // 告警：带新低标签 + 事件本身是近期的
      const isLow = it.tags.some((t) => LOW_TAGS.includes(t));
      if (isLow && isNew && !SEED && ts != null && ts >= freshTs) {
        const alert = { ts: now, product: p.id, productName: p.name, config: ckey, price: it.price, date: it.date, platform: it.platform, name: it.name, tags: it.tags, priceText: it.priceText };
        allAlerts.push(alert);
        appendLine(ALERT_FILE, alert);
      }
    }

    // ---------- 统计（按配置维度） ----------
    const all = Object.values(st.seen);
    const byConfig = {};
    for (const s of all) {
      const k = s.config || '未知配置';
      (byConfig[k] = byConfig[k] || []).push(s);
    }

    const cfgRows = [];
    for (const [k, list] of Object.entries(byConfig)) {
      const dated = list.filter((s) => s.ts != null).sort((a, b) => b.ts - a.ts);
      const d7 = dated.filter((s) => s.ts >= Date.now() - 7 * DAY);
      const d30 = dated.filter((s) => s.ts >= Date.now() - 30 * DAY);
      const curRec = d7.length ? d7.reduce((a, b) => (b.price < a.price ? b : a)) : (dated[0] || null);
      const lowest = (st.lowestByConfig[k] && st.lowestByConfig[k].price) || Math.min(...list.map((s) => s.price));
      cfgRows.push({
        product: p.id, productName: p.name, config: k,
        current: curRec ? curRec.price : null,
        curDate: curRec ? curRec.date : null,
        curTs: curRec ? curRec.ts : null,
        curPlatform: curRec ? curRec.platform : null,
        lowestEver: lowest,
        lowestEverAt: (st.lowestByConfig[k] && st.lowestByConfig[k].date) || null,
        avg30: d30.length ? d30.reduce((a, b) => a + b.price, 0) / d30.length : null,
        n: list.length,
        recent: dated.slice(0, 5),
      });
    }
    cfgRows.sort((a, b) => (a.current ?? 1e9) - (b.current ?? 1e9));

    const datedAll = all.filter((s) => s.ts != null).sort((a, b) => b.ts - a.ts);
    const d30All = datedAll.filter((s) => s.ts >= Date.now() - 30 * DAY);
    const curAll = d30All.length ? d30All.reduce((a, b) => (b.price < a.price ? b : a)) : (datedAll[0] || null);

    reportRows.push({
      id: p.id, name: p.name, note: p.note,
      current: curAll ? curAll.price : null, curDate: curAll ? curAll.date : null, curPlatform: curAll ? curAll.platform : null,
      lowestEver: st.lowestEver, lowestEverAt: st.lowestEverAt,
      avg30: d30All.length ? d30All.reduce((a, b) => a + b.price, 0) / d30All.length : null,
      min30: d30All.length ? Math.min(...d30All.map((s) => s.price)) : null,
      avgAll: all.length ? all.reduce((a, b) => a + b.price, 0) / all.length : null,
      freshCount: fresh.length,
      fresh: fresh.map((f) => ({ price: f.price, date: f.date, platform: f.platform, tags: f.tags, name: f.name, config: f.config })),
      sample: datedAll.slice(0, 8).map((i) => ({ price: i.price, date: i.date, platform: i.platform, tags: i.tags, config: i.config })),
      cfgRows,
    });

    state.products[p.id] = st;
    console.error(`  ${p.id}: ${items.length} hits, ${fresh.length} new, cfg=${cfgRows.length}, cur=${curAll && curAll.price}@${curAll && curAll.date}`);
  }

  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');

  // CSV
  const csvExists = fs.existsSync(CSV_FILE);
  const csv = [];
  if (!csvExists) csv.push('date,product,productName,platform,price,tags,itemName');
  const hist = fs.existsSync(HIST_FILE)
    ? fs.readFileSync(HIST_FILE, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];
  for (const h of hist) {
    csv.push([h.date, h.product, h.productName, h.platform, h.price, (h.tags || []).join('/'), `"${(h.name || '').replace(/"/g, '""')}"`].join(','));
  }
  fs.writeFileSync(CSV_FILE, csv.join('\n'), 'utf8');

  const md = buildReport(cfg, reportRows, allAlerts);
  fs.writeFileSync(REPORT, md, 'utf8');

  // 每日快照归档
  const snapDir = path.join(ROOT, 'reports');
  fs.mkdirSync(snapDir, { recursive: true });
  const snap = path.join(snapDir, `${today()}.md`);
  if (!fs.existsSync(snap)) fs.writeFileSync(snap, md, 'utf8');

  console.error(`\nreport written: ${REPORT}  (${allAlerts.length} new 历史新低 events)`);
  console.error(`snapshot: ${snap}`);
  return { alerts: allAlerts, rows: reportRows };
}

function fmt(n) {
  if (n == null) return '—';
  return '¥' + Number(n).toFixed(2);
}
function bar(pct) {
  const n = Math.round(Math.max(0, Math.min(1, pct)) * 10);
  return '█'.repeat(n) + '░'.repeat(10 - n);
}

function buildReport(cfg, rows, alerts) {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const L = [];
  L.push('# 电脑价格监控日报');
  L.push('');
  L.push(`> 更新时间：**${stamp}** (Asia/Shanghai) · 数据源：慢慢买全网比价（含京东自营 / 天猫 / 淘宝 / 拼多多）`);
  L.push('');

  L.push('## 🔔 今日新增「历史新低」');
  L.push('');
  if (!alerts.length) {
    L.push('今日无新增历史新低事件。');
    L.push('');
  } else {
    L.push('| 商品 | 配置 | 到手价 | 平台 | 时间 | 标记 |');
    L.push('|---|---|---:|---|---|---|');
    for (const a of alerts) {
      L.push(`| ${a.productName} | ${a.config || '-'} | **${fmt(a.price)}** | ${a.platform || '-'} | ${a.date} | ${(a.tags || []).join('/')} |`);
    }
    L.push('');
  }

  L.push('## 📊 监控总览（按配置，同型号不同配置不可混比）');
  L.push('');
  L.push('| 商品 | 配置 | 当前最低价 | 日期 | 平台 | 历史最低 | 距历史新低 | 30天均价 |');
  L.push('|---|---|---:|---|---|---:|---|---:|');
  const allCfg = rows.flatMap((r) => r.cfgRows.map((c) => ({ ...c, note: r.note })));
  for (const c of allCfg) {
    const vsLow = c.lowestEver && c.current ? (c.current / c.lowestEver - 1) * 100 : null;
    const atLow = vsLow != null && Math.abs(vsLow) < 0.5;
    const badge = c.n < 2 ? '⚪ 样本少' : vsLow == null ? '—' : atLow ? '🟢 **新低**' : '⚪ +' + vsLow.toFixed(1) + '%';
    L.push(
      `| ${c.productName} | ${c.config} | **${fmt(c.current)}** | ${c.curDate || '—'} | ${c.curPlatform || '-'} | ${fmt(c.lowestEver)} | ${badge} | ${fmt(c.avg30)} |`
    );
  }
  L.push('');
  L.push('> 「距历史新低」= 当前价相对该配置历史最低价的溢价。越接近 0% 越接近抄底点。');
  L.push('');

  L.push('## 🕐 各商品近期价格轨迹');
  L.push('');
  for (const r of rows) {
    L.push(`### ${r.name}`);
    if (r.note) L.push(`*${r.note}*`);
    L.push('');
    if (!r.sample.length) { L.push('（近期无价格记录）\n'); continue; }
    L.push('| 时间 | 配置 | 平台 | 价格 | 标记 |');
    L.push('|---|---|---|---:|---|');
    for (const s of r.sample) {
      L.push(`| ${s.date} | ${s.config || '-'} | ${s.platform || '-'} | ${fmt(s.price)} | ${(s.tags || []).filter(Boolean).join('/') || '-'} |`);
    }
    L.push('');
  }

  L.push('## 🧭 行动建议');
  L.push('');
  const sorted = allCfg.filter((c) => c.current).sort((a, b) => a.current - b.current);
  const inBudget = sorted.filter((c) => c.current <= 4000);
  const fresh30 = (c) => c.curTs && Date.now() - c.curTs <= 30 * DAY;
  const near = inBudget.filter((c) => c.n >= 2 && c.lowestEver && c.current / c.lowestEver < 1.06 && fresh30(c));
  const gapText = (c) => {
    const g = (c.current / c.lowestEver - 1) * 100;
    return g < 0.5 ? '已是该配置历史最低价' : `比历史最低仅高 ${Math.round(g)}%`;
  };
  if (near.length) {
    L.push('**🎯 预算内 + 接近历史最低价 + 近 30 天有报价，优先考虑：**');
    L.push('');
    for (const c of near) {
      L.push(`- **${c.productName} · ${c.config}** — **${fmt(c.current)}**（${c.curDate || ''} ${c.curPlatform || ''}），${gapText(c)}`);
    }
  } else {
    L.push('预算内暂无商品同时满足「近 30 天有报价」与「接近历史最低价」，继续等待。');
  }
  L.push('');
  if (inBudget.length) {
    L.push('**💰 4000 元预算内全部可选配置（按当前最低价排序）：**');
    L.push('');
    L.push('| 商品 | 配置 | 当前最低价 | 日期 | 平台 | 距历史新低 | 样本数 |');
    L.push('|---|---|---:|---|---|---|---:|');
    for (const c of inBudget) {
      const vsLow = c.lowestEver ? (c.current / c.lowestEver - 1) * 100 : null;
      const stale = !fresh30(c);
      L.push(`| ${c.productName} | ${c.config}${c.config === '未知配置' ? ' ⚠️' : ''} | **${fmt(c.current)}** | ${c.curDate || '—'}${stale ? ' ⚠️' : ''} | ${c.curPlatform || '-'} | ${vsLow == null ? '—' : '+' + vsLow.toFixed(1) + '%'} | ${c.n} |`);
    }
    L.push('');
    L.push('> ⚠️ = 标题里未能识别出配置，或最近一次报价已超过 30 天，下单前请人工核对。');
    L.push('');
  }
  const belowAvg = sorted.filter((c) => c.avg30 && c.current <= c.avg30);
  if (belowAvg.length) {
    L.push('**📉 当前低于 30 天均价：** ' + belowAvg.map((c) => `${c.productName} ${c.config} ${fmt(c.current)}`).join('；'));
    L.push('');
  }
  L.push('---');
  L.push('');
  L.push('### 附：如何买最划算（2026 年存储涨价周期）');
  L.push('');
  L.push('1. **优先京东自营/天猫旗舰店**，拼多多百亿补贴虽便宜但售后与退换风险自担。');
  L.push('2. **国补 + 平台券 + 88VIP 叠加** 是当前最大折扣来源，缺一不可。');
  L.push('3. **内存别省**：2026 年 DDR5 涨幅超 3 倍，16G 是底线，能选 32G 就选 32G。');
  L.push('4. **双11 当天通常不更便宜**（冲量在前半段），建议 10 月底至 11 月 3 日之间下手。');
  L.push('5. 存储紧缺预计延续到 2027 下半年，**「等降价」不成立**。');
  L.push('');
  L.push('*本报告由本地监控脚本自动抓取慢慢买公开比价数据生成，仅供参考。*');
  return L.join('\n');
}

module.exports = { main };

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
