import { createClient } from '@supabase/supabase-js';
import cheerio from 'cheerio';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
const num = s => { const m = String(s || '').match(/[\d\s\u00A0]{2,}/); if (!m) return null; const n = +m[0].replace(/[\s\u00A0]/g, ''); return n > 0 && n < 1000000 ? n : null; };
const normUrl = u => { try { const x = new URL(u); x.hash = ''; if (/utm|ref=|yclid|gclid/.test(x.search)) x.search = ''; return x.href.replace(/\/+$/, ''); } catch { return u; } };
const abs = (base, u) => { if (!u) return null; try { return normUrl(new URL(u, base).href); } catch { return null; } };

async function fetchHtml(url) {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9', 'Accept': 'text/html,application/xhtml+xml' }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } catch (e) { if (i === 1) throw e; await sleep(1500); }
  }
}

/* ===== детерминированный generic-парсер карточек ===== */
function parseCards(html, baseUrl) {
  const $ = cheerio.load(html);
  $('script,style,noscript').remove();
  const cards = [], seen = new Set();
  $('a:has(img)').each((_, a) => {
    const $a = $(a);
    const url = abs(baseUrl, $a.attr('href'));
    if (!url || url === normUrl(baseUrl) || seen.has(url)) return;
    if (/(cart|checkout|login|profile|favorite|compare|order)/i.test(url)) return;
    let $scope = $a;
    for (let d = 0; d < 4; d++) {
      const p = $scope.parent();
      if (!p.length) break;
      $scope = p;
      const t = clean($scope.text());
      if (t.length > 40 && t.length < 700 && /[\d\s\u00A0]{3,}\s*(₽|руб\.?|р\.?)/i.test(t)) break;
    }
    const txt = clean($scope.text());
    const pm = txt.match(/(от\s*)?([\d\s\u00A0]{3,})\s*(₽|руб\.?|р\.?)/i);
    const price = pm ? num(pm[2]) : null;
    if (!price) return;
    const priceFrom = /от\s/i.test(pm[0] || '');
    const old = num(clean($scope.find('s,del,[class*="old"],[class*="strike"],[class*="cross"]').first().text()));
    const $img = $scope.find('img').first();
    const imgRaw = $img.attr('src') || $img.attr('data-src') || $img.attr('data-lazy-src') || ($img.attr('srcset') || '').split(/[\s,]+/)[0];
    const img = imgRaw && !imgRaw.startsWith('data:') ? abs(baseUrl, imgRaw) : null;
    if (!img) return;
    let title = clean($a.attr('title'))
      || clean($scope.find('h3,h2,h4,[class*="name"],[class*="title"]').first().text())
      || clean($a.text()).replace(/[\d\s\u00A0]{3,}(₽|руб\.?|р\.?).?/gi, '').replace(/в\s*корзину.*/i, '')
      || clean($img.attr('alt'));
    if (!title || title.length < 5) return;
    seen.add(url);
    cards.push({ url, title: title.slice(0, 200), price, price_old: old && old > price ? old : null, img, from: priceFrom });
  });
  return cards;
}
function discoverLinks(html, baseUrl) {
  const $ = cheerio.load(html); const out = new Set();
  $('a').each((_, a) => {
    const t = clean($(a).text()); const u = abs(baseUrl, $(a).attr('href'));
    if (!u || u === normUrl(baseUrl)) return;
    if (/смотреть все|все букеты|все категории|все товары|каталог/i.test(t) || /\/(catalog|shop|products|bukety|cvety|flowers|bouquet)\//i.test(u)) out.add(u);
  });
  return [...out].slice(0, 8);
}
function nextPages(html, baseUrl, cur) {
  const $ = cheerio.load(html); const out = new Set();
  $('a[rel="next"]').each((_, a) => { const u = abs(baseUrl, $(a).attr('href')); if (u) out.add(u); });
  $('a').each((_, a) => {
    const t = clean($(a).text());
    if (/^(далее|вперед|вперёд|следующая|»|>)$/i.test(t) || /показать ещё|показать еще|загрузить ещё/i.test(t)) { const u = abs(baseUrl, $(a).attr('href')); if (u) out.add(u); }
  });
  return [...out].filter(u => u !== cur).slice(0, 2);
}

/* ===== LLM-fallback: только если детерминизм не нашёл ничего ===== */
async function llmCards(html, baseUrl) {
  const $ = cheerio.load(html); $('script,style').remove();
  const text = clean($('body').text()).slice(0, 12000);
  if (text.length < 200) return [];
  const prompt = 'Из текста страницы цветочного магазина верни СТРОГО JSON-массив без пояснений: [{"t":"название","p":цена_число,"po":старая_цена_число_или_null}]. Только реальные товары с ценами. Текст: ' + text;
  try {
    const { data: rid, error } = await sb.rpc('ai_start', { prompt, model: 'gpt://b1gg2keram6ur6r9774q/yandexgpt-5-lite' });
    if (error) return [];
    for (let i = 0; i < 10; i++) {
      await sleep(1000);
      const r = await sb.rpc('ai_result', { req_id: rid });
      if (r.error) return [];
      if (r.data) {
        try {
          const arr = JSON.parse(String(r.data).replace(/```json|```/g, '').trim());
          return arr.filter(x => x && x.t && x.p).map(x => ({
            url: normUrl(baseUrl) + '#llm-' + String(x.t).toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-').slice(0, 40),
            title: String(x.t).slice(0, 200), price: +x.p, price_old: x.po ? +x.po : null, img: null, from: false, llm: true
          }));
        } catch { return []; }
      }
    }
  } catch (e) { console.warn('llm fallback:', e.message); }
  return [];
}

function autoTags(title, price) {
  const low = title.toLowerCase(); const t = new Set();
  [['роз', 'розы'], ['пион', 'пионы'], ['тюльпан', 'тюльпаны'], ['хризантем', 'хризантемы'], ['гортенз', 'гортензии'], ['лили', 'лилии'], ['эустом', 'эустома'], ['альстремер', 'альстромерия'], ['ромаш', 'ромашки'], ['гвоздик', 'гвоздики'], ['подсолнух', 'подсолнухи']].forEach(x => low.includes(x[0]) && t.add(x[1]));
  [['маме', 'маме'], ['девушк', 'девушке'], ['жене', 'жене'], ['подруг', 'подруге'], ['учител', 'учителю'], ['свадеб', 'свадьба'], ['невест', 'свадьба']].forEach(x => low.includes(x[0]) && t.add(x[1]));
  if (/нежн|пастель|бел/.test(low)) t.add('нежный');
  if (/ярк|микс|сочн/.test(low)) t.add('яркий');
  if (price) t.add(price <= 2500 ? 'до 2500' : price <= 4000 ? '2500-4000' : '4000+');
  t.add('день рождения'); t.add('просто так');
  return [...t].slice(0, 10);
}
const logChange = (bid, type, ov, nv) => sb.from('scraper_changes').insert({ bouquet_id: bid, change_type: type, old_value: ov, new_value: nv });

/* ===== синхронизация: new / price_change / removed ===== */
async function syncSource(src, cards) {
  const { data: shop } = await sb.from('shops').select('*').eq('id', src.shop_id).single();
  let ownerId = shop && shop.owner_id;
  if (!ownerId) {
    ownerId = crypto.randomUUID();
    await sb.from('profiles').upsert({ id: ownerId, nick: ((shop && shop.name) || 'магазин') + ' · каталог', is_florist: true });
    await sb.from('shops').update({ owner_id: ownerId }).eq('id', src.shop_id);
  }
  const { data: existing } = await sb.from('bouquets').select('id,source_url,price,title,photo_url,is_available').eq('source_shop_id', src.id);
  const byUrl = new Map((existing || []).map(b => [normUrl(b.source_url || ''), b]));
  const found = new Set();
  let nNew = 0, nUpd = 0;
  const rawRows = [];
  for (const c of cards) {
    found.add(c.url);
    const cur = byUrl.get(c.url);
    let bouquetId = cur ? cur.id : null;
    if (cur) {
      const upd = { last_checked_at: new Date().toISOString(), is_available: true };
      let changed = false;
      if (c.price && Number(cur.price) !== c.price) { upd.price = c.price; upd.price_previous = cur.price; await logChange(cur.id, 'price_change', { price: Number(cur.price) }, { price: c.price }); changed = true; nUpd++; }
      if (c.title && c.title !== cur.title) { upd.title = c.title; changed = true; }
      if (c.img && cur.photo_url !== c.img) { upd.photo_url = c.img; changed = true; }
      await sb.from('bouquets').update(upd).eq('id', cur.id);
    } else if (c.img) {
      const desc = c.from ? 'Цена «от» — зависит от размера букета.' : '';
      const { data: nb, error } = await sb.from('bouquets').insert({
        title: c.title, price: c.price || 0, description: desc, category: 'сборный', tags: autoTags(c.title, c.price),
        photo_url: c.img, in_stock: true, user_id: ownerId,
        source_url: c.url, source_shop_id: src.id, source_image_url: c.img, last_checked_at: new Date().toISOString()
      }).select();
      if (!error && nb && nb[0]) { bouquetId = nb[0].id; await logChange(nb[0].id, 'new_product', null, { title: c.title, price: c.price }); nNew++; }
    }
    rawRows.push({ source_id: src.id, external_id: c.url, title: c.title, price: c.price, price_old: c.price_old, image_url: c.img, product_url: c.url, category: '', raw_data: { from: c.from, llm: !!c.llm }, is_processed: true, bouquet_id: bouquetId });
  }
  if (rawRows.length) await sb.from('scraper_raw_products').insert(rawRows.slice(0, 400));
  // исчезнувшие — скрываем, но не удаляем; защита от частичного сбоя
  const prevTotal = (existing || []).length;
  if (cards.length >= Math.max(3, Math.round(prevTotal * 0.4))) {
    for (const b of existing || []) {
      if (b.is_available !== false && !found.has(normUrl(b.source_url || ''))) {
        await sb.from('bouquets').update({ is_available: false }).eq('id', b.id);
        await logChange(b.id, 'removed_product', { title: b.title }, null);
      }
    }
  } else if (prevTotal > 0) {
    await sb.from('scraper_sources').update({ status: 'warn', error_message: 'Подозрительно мало товаров (' + cards.length + ' из ' + prevTotal + ') —Availability не трогал' }).eq('id', src.id);
  }
  await sb.from('shops').update({ catalog_updated_at: new Date().toISOString() }).eq('id', src.shop_id);
  return { nNew, nUpd };
}

async function runSource(src) {
  const job = await sb.from('scraper_jobs').insert({ source_id: src.id, status: 'running', started_at: new Date().toISOString() }).select();
  const jobId = job.data && job.data[0] && job.data[0].id;
  try {
    const html = await fetchHtml(src.source_url);
    const pages = [src.source_url, ...discoverLinks(html, src.source_url)];
    const cards = [], seen = new Set();
    for (const p of pages.slice(0, 8)) {
      const ph = p === src.source_url ? html : await fetchHtml(p).catch(() => null);
      if (!ph) continue;
      for (const c of parseCards(ph, p)) { if (!seen.has(c.url)) { seen.add(c.url); cards.push(c); } }
      for (const np of nextPages(ph, p, p)) {
        const nh = await fetchHtml(np).catch(() => null);
        if (nh) for (const c of parseCards(nh, np)) { if (!seen.has(c.url)) { seen.add(c.url); cards.push(c); } }
      }
      if (cards.length >= 300) break;
    }
    let usedLlm = false;
    if (!cards.length) { const lc = await llmCards(html, src.source_url); if (lc.length) { cards.push(...lc); usedLlm = true; } }
    const { nNew, nUpd } = await syncSource(src, cards);
    // адаптивная частота
    let interval = src.scrape_interval_hours || 12;
    if (cards.length) {
      const rate = (nNew + nUpd) / cards.length;
      interval = rate >= 0.15 ? 6 : rate === 0 ? Math.min(48, interval + 6) : 12;
    }
    await sb.from('scraper_sources').update({ last_scraped_at: new Date().toISOString(), last_success_at: new Date().toISOString(), total_products: cards.length, scrape_interval_hours: interval, status: 'active', error_message: usedLlm ? 'worked via LLM-fallback' : null, updated_at: new Date().toISOString() }).eq('id', src.id);
    await sb.from('scraper_jobs').update({ status: 'completed', completed_at: new Date().toISOString(), products_found: cards.length, products_new: nNew, products_updated: nUpd }).eq('id', jobId);
    console.log('[ok]', src.source_url, 'found', cards.length, 'new', nNew, 'upd', nUpd);
  } catch (e) {
    await sb.from('scraper_sources').update({ status: 'error', error_message: String(e.message || e).slice(0, 300), last_scraped_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', src.id);
    await sb.from('scraper_jobs').update({ status: 'failed', completed_at: new Date().toISOString(), error_message: String(e.message || e).slice(0, 300) }).eq('id', jobId);
    console.log('[err]', src.source_url, e.message);
  }
}

const now = Date.now();
const { data: sources } = await sb.from('scraper_sources').select('*').neq('status', 'paused');
for (const src of sources || []) {
  const due = !src.last_scraped_at || now - new Date(src.last_scraped_at).getTime() >= (src.scrape_interval_hours || 12) * 3600e3;
  if (!due) continue;
  await runSource(src);
}
await sb.from('scraper_raw_products').delete().lt('scraped_at', new Date(now - 14 * 864e5).toISOString());
console.log('done');
