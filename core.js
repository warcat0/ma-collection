/* Cœur de l'appli : stockage (IndexedDB), prix TCGdex, calculs.
   Utilisé par la page ET par le service worker (mise à jour en arrière-plan). */
(function (root) {
  'use strict';

  const DB_NAME = 'ma-collection-pokemon';
  const DB_VERSION = 1;
  const API = 'https://api.tcgdex.net/v2';

  // ---------- Dates ----------
  function today(d) {
    const x = d || new Date();
    const m = String(x.getMonth() + 1).padStart(2, '0');
    const j = String(x.getDate()).padStart(2, '0');
    return x.getFullYear() + '-' + m + '-' + j;
  }

  // ---------- IndexedDB ----------
  let dbPromise = null;
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots', { keyPath: 'date' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  async function tx(store, mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let out;
      Promise.resolve(fn(s)).then(v => { out = v; });
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }
  function reqP(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  async function getAll(store) {
    const db = await openDb();
    return reqP(db.transaction(store).objectStore(store).getAll());
  }
  async function put(store, obj) { return tx(store, 'readwrite', s => { s.put(obj); }); }
  async function putMany(store, arr) { return tx(store, 'readwrite', s => { arr.forEach(o => s.put(o)); }); }
  async function del(store, key) { return tx(store, 'readwrite', s => { s.delete(key); }); }
  async function clear(store) { return tx(store, 'readwrite', s => { s.clear(); }); }
  async function getMeta(k, def) {
    const db = await openDb();
    const r = await reqP(db.transaction('meta').objectStore('meta').get(k));
    return r ? r.v : def;
  }
  async function setMeta(k, v) { return put('meta', { k, v }); }

  // ---------- TCGdex ----------
  async function apiGet(path) {
    const r = await fetch(API + path, { headers: { Accept: 'application/json' } });
    if (!r.ok) {
      const err = new Error('HTTP ' + r.status);
      err.status = r.status;
      throw err;
    }
    return r.json();
  }
  function searchCards(lang, name, number) {
    const q = [];
    if (name) q.push('name=' + encodeURIComponent(name));
    if (number) q.push('localId=eq:' + encodeURIComponent(number));
    q.push('pagination:page=1', 'pagination:itemsPerPage=60');
    return apiGet('/' + lang + '/cards?' + q.join('&'));
  }
  function getCard(lang, id) { return apiGet('/' + lang + '/cards/' + encodeURIComponent(id)); }
  function imageUrl(base, quality) { return base ? base + '/' + (quality || 'low') + '.webp' : ''; }

  /* Choisit le prix d'une carte à partir de la réponse TCGdex.
     variant : 'normal' ou 'holo' (holo / reverse).
     Ordre : Cardmarket tendance → moyenne 7 j → moyenne 30 j → moyenne ;
     sinon TCGplayer (USD converti en EUR). */
  function priceFromCard(card, variant, usdRate) {
    const p = card && card.pricing;
    if (!p) return null;
    const cm = p.cardmarket;
    const pick = (o, keys) => { for (const k of keys) { const v = o && o[k]; if (typeof v === 'number' && v > 0) return v; } return null; };
    if (cm) {
      const sfx = variant === 'holo' ? '-holo' : '';
      let v = pick(cm, ['trend' + sfx, 'avg7' + sfx, 'avg30' + sfx, 'avg' + sfx]);
      if (v == null && variant === 'holo') v = pick(cm, ['trend', 'avg7', 'avg30', 'avg']);
      if (v == null && variant !== 'holo') v = pick(cm, ['trend-holo', 'avg7-holo', 'avg30-holo', 'avg-holo']);
      if (v != null) return { price: round2(v), source: 'Cardmarket', updated: cm.updated || null };
    }
    const tp = p.tcgplayer;
    if (tp) {
      const order = variant === 'holo'
        ? ['holofoil', 'reverse', 'reverseHolofoil', 'holo', 'normal']
        : ['normal', 'holofoil', 'holo', 'reverse', 'reverseHolofoil'];
      for (const k of order) {
        const o = tp[k];
        const v = o && (o.marketPrice || o.midPrice);
        if (typeof v === 'number' && v > 0) {
          return { price: round2(v * (usdRate || 0.86)), source: 'TCGplayer (converti)', updated: tp.updated || null };
        }
      }
    }
    return null;
  }

  // ---------- Cardmarket (scellé) : fichiers mis à jour chaque jour par GitHub ----------
  let cmPrices = null, cmCatalogue = null;
  async function loadJson(path) {
    const r = await fetch(path + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    return r.json();
  }
  async function cmLoadPrices(force) {
    if (!cmPrices || force) cmPrices = await loadJson('./data/prix.json');
    return cmPrices;
  }
  async function cmLoadCatalogue() {
    if (!cmCatalogue) cmCatalogue = await loadJson('./data/scelle.json');
    return cmCatalogue;
  }
  function cmPrice(prices, id) {
    const row = prices && prices.p && prices.p[id];
    if (!row) return null;
    for (const v of row) if (typeof v === 'number' && v > 0) return { price: round2(v), source: 'Cardmarket', updated: prices.source || prices.date };
    return null;
  }

  // ---------- Valeur ----------
  function round2(n) { return Math.round(n * 100) / 100; }
  function unitValue(it) {
    const mode = it.priceMode || 'manual';
    if (mode === 'auto') return it.autoPrice != null ? it.autoPrice : (it.manualPrice || 0);
    if (mode === 'coef') return it.autoPrice != null ? round2(it.autoPrice * (Number(it.coef) || 1)) : (it.manualPrice || 0);
    return it.manualPrice || 0;
  }
  function lineValue(it) { return round2(unitValue(it) * (Number(it.qty) || 1)); }
  function lineCost(it) { return it.buyPrice != null && it.buyPrice !== '' ? round2(Number(it.buyPrice) * (Number(it.qty) || 1)) : null; }
  function totals(items) {
    const t = { total: 0, sealed: 0, raw: 0, graded: 0, cost: 0, costKnown: 0, count: 0 };
    for (const it of items) {
      const v = lineValue(it);
      t.total += v; t[it.cat] = (t[it.cat] || 0) + v;
      t.count += Number(it.qty) || 1;
      const c = lineCost(it);
      if (c != null) { t.cost += c; t.costKnown += v; }
    }
    for (const k of ['total', 'sealed', 'raw', 'graded', 'cost', 'costKnown']) t[k] = round2(t[k]);
    return t;
  }

  // Ajoute/remplace la valeur du jour dans l'historique d'un article.
  function stampHistory(it, date) {
    const v = unitValue(it);
    it.history = Array.isArray(it.history) ? it.history : [];
    const last = it.history[it.history.length - 1];
    if (last && last[0] === date) last[1] = v; else it.history.push([date, v]);
    if (it.history.length > 1500) it.history = it.history.slice(-1500);
  }

  async function writeSnapshot(items, date) {
    const t = totals(items);
    await put('snapshots', { date, total: t.total, sealed: t.sealed, raw: t.raw, graded: t.graded, cost: t.cost });
    return t;
  }

  /* Met à jour les prix automatiques puis enregistre le point du jour.
     Sans réseau, le point du jour est quand même enregistré avec les derniers prix connus. */
  async function updateAll(opts) {
    opts = opts || {};
    const date = today();
    const usdRate = await getMeta('usdRate', 0.86);
    const items = await getAll('items');
    const isAuto = it => it.priceMode === 'auto' || it.priceMode === 'coef';
    const linked = items.filter(it => it.tcgdexId && isAuto(it));
    const cmItems = items.filter(it => it.cmId && isAuto(it));
    let cmOk = 0, cmFail = 0;
    if (cmItems.length) {
      let prices = null;
      try { prices = await cmLoadPrices(true); } catch (e) { /* hors ligne ou fichier absent */ }
      for (const it of cmItems) {
        const pr = prices ? cmPrice(prices, it.cmId) : null;
        if (pr) { it.autoPrice = pr.price; it.priceSource = pr.source; it.priceUpdated = pr.updated; it.priceStatus = 'ok'; cmOk++; }
        else { it.priceStatus = prices ? 'none' : 'error'; cmFail++; }
      }
    }
    const cache = new Map();
    let ok = 0, fail = 0, done = 0;
    const queue = linked.slice();
    async function worker() {
      while (queue.length) {
        const it = queue.shift();
        const key = (it.tcgdexLang || 'en') + '|' + it.tcgdexId;
        try {
          if (!cache.has(key)) cache.set(key, getCard(it.tcgdexLang || 'en', it.tcgdexId));
          const card = await cache.get(key);
          const pr = priceFromCard(card, it.variant, usdRate);
          if (pr) {
            it.autoPrice = pr.price; it.priceSource = pr.source; it.priceUpdated = pr.updated || new Date().toISOString();
            it.priceStatus = 'ok'; ok++;
          } else { it.priceStatus = 'none'; fail++; }
        } catch (e) { it.priceStatus = 'error'; fail++; }
        done++;
        if (opts.onProgress) opts.onProgress(done, linked.length);
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);
    items.forEach(it => stampHistory(it, date));
    await putMany('items', items);
    const t = await writeSnapshot(items, date);
    await setMeta('lastUpdate', new Date().toISOString());
    await setMeta('lastUpdateDay', date);
    return { ok: ok + cmOk, fail: fail + cmFail, linked: linked.length + cmItems.length, totals: t };
  }

  root.Core = {
    today, openDb, getAll, put, putMany, del, clear, getMeta, setMeta,
    searchCards, getCard, imageUrl, priceFromCard, cmLoadPrices, cmLoadCatalogue, cmPrice,
    unitValue, lineValue, lineCost, totals, stampHistory, writeSnapshot, updateAll, round2
  };
})(typeof self !== 'undefined' ? self : this);
