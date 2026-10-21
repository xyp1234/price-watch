'use strict';
const cheerio = require('cheerio');
const iconv = require('iconv-lite');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// manmanbuy is a GB2312/GBK site: Chinese query strings must be GBK-encoded
function gbkEncode(str) {
  const buf = iconv.encode(str, 'gbk');
  let out = '';
  for (const b of buf) {
    if (b >= 0x41 && b <= 0x5a) out += String.fromCharCode(b);
    else if (b >= 0x30 && b <= 0x39) out += String.fromCharCode(b);
    else if (b === 0x2d || b === 0x5f || b === 0x2e || b === 0x7e) out += String.fromCharCode(b);
    else out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

const CARD = 'div[class*="DiscountItemPC_discountItem"]';

function parsePriceText(raw) {
  if (!raw) return null;
  const t = String(raw).replace(/\s+/g, ' ').trim();
  const m = t.match(/(\d{3,6}(?:\.\d{1,2})?)\s*元/);
  const price = m ? parseFloat(m[1]) : null;
  const notes = [];
  if (/历史新低/.test(t)) notes.push('历史新低');
  if (/30天新低/.test(t)) notes.push('30天新低');
  if (/60天新低/.test(t)) notes.push('60天新低');
  if (/含国补/.test(t)) notes.push('国补');
  if (/教育优惠|学生/.test(t)) notes.push('教育优惠');
  if (/淘金币/.test(t)) notes.push('淘金币');
  if (/百亿补贴|补贴/.test(t)) notes.push('补贴');
  if (/已结束/.test(t)) notes.push('已结束');
  if (/再降价/.test(t)) notes.push('再降价');
  return { price, text: t, notes };
}

function parseMetaText(raw) {
  if (!raw) return { dt: '', platform: '', extra: '' };
  const t = String(raw).replace(/\s+/g, ' ').trim();
  const dt = (t.match(/(\d{1,2}-\d{1,2})\s+(\d{1,2}:\d{2})/) || []);
  const plat = t.match(/(京东自营|京东|天猫|淘宝|拼多多|苏宁|唯品会|抖音)/);
  return {
    dt: dt[1] ? `${dt[1]} ${dt[2]}` : '',
    platform: plat ? plat[1] : '',
    extra: t,
  };
}

function extract(html) {
  const $ = cheerio.load(html);
  const out = [];
  $(CARD).each((_, el) => {
    const $c = $(el);
    const $title = $c.find('div[class*="DiscountItemPC_itemTitle"] a').first();
    const $price = $c.find('div[class*="DiscountItemPC_itemSubTitle"] a').first();
    const name = ($title.attr('title') || $title.text() || '').trim();
    const p = parsePriceText($price.text());
    if (!name || !p || !p.price) return;

    const $meta = $c.find('div[class*="DiscountItemPC_itemMeta"]').first();
    const meta = parseMetaText($meta.text());
    const tags = $c.find('div[class*="DiscountItemPC_itemTag"]').map((__, t) => $(t).text().trim()).get();

    // 去看看 -> real shop url
    let shopUrl = '';
    $meta.find('a[href]').each((__, a) => {
      const h = $(a).attr('href') || '';
      if (/jd\.com|tmall|taobao|yangkeduo|suning|vip\.com|douyin/i.test(h)) shopUrl = h;
    });
    if (!shopUrl) {
      const anyHref = $c.find('a[href]').map((__, a) => $(a).attr('href')).get()
        .find((h) => /jd\.com|tmall|taobao|yangkeduo/i.test(h || ''));
      shopUrl = anyHref || '';
    }

    const baoliao = $c.find('a[href*="discuxiao_"]').map((__, a) => $(a).attr('href')).get()[0] || '';

    out.push({
      name,
      price: p.price,
      priceText: p.text,
      notes: p.notes,
      tags,
      date: meta.dt,
      platform: meta.platform,
      shopUrl,
      baoliaoUrl: baoliao,
      metaText: meta.extra,
    });
  });
  return out;
}

async function fetchSearch(keyword, { c = 'discount', page = 1 } = {}) {
  const url = `https://s.manmanbuy.com/Default.aspx?key=${gbkEncode(keyword)}&c=${c}&pageId=${page}`;
  const r = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'zh-CN,zh;q=0.9',
      Referer: 'https://www.manmanbuy.com/',
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  const html = await r.text();
  return { url, html, items: extract(html) };
}

module.exports = { fetchSearch, extract, parsePriceText, UA };
