/* Interface de l'appli. Les données et les prix passent par Core (core.js). */
(function () {
  'use strict';

  // ---------- Référentiels ----------
  const CATS = {
    sealed: { label: 'Scellé', cls: 'c-sealed' },
    raw: { label: 'Cartes', cls: 'c-raw' },
    graded: { label: 'Gradées', cls: 'c-graded' }
  };
  const LANGS = [
    { code: 'fr', short: 'FR', name: 'Français' },
    { code: 'en', short: 'EN', name: 'Anglais' },
    { code: 'ja', short: 'JP', name: 'Japonais' },
    { code: 'zh-tw', short: 'CN-T', name: 'Chinois traditionnel' },
    { code: 'zh-cn', short: 'CN-S', name: 'Chinois simplifié' }
  ];
  const LANG = Object.fromEntries(LANGS.map(l => [l.code, l]));
  const GRADERS = ['PSA', 'PCA', 'CCC', 'CGC', 'Autre'];
  const GRADES = ['10', '9.5', '9', '8.5', '8', '7.5', '7', '6.5', '6', '5.5', '5', '4.5', '4', '3.5', '3', '2.5', '2', '1.5', '1', 'Authentique'];
  const SEALED_TYPES = ['Display / Booster box', 'Coffret Dresseur d\'élite (ETB)', 'Coffret', 'Coffret collection premium', 'Tripack', 'Blister', 'Booster', 'Mini-tin / Pokébox', 'Autre'];
  const PERIODS = [['7J', 7], ['1M', 31], ['3M', 92], ['1A', 366], ['Tout', 0]];

  // ---------- État ----------
  const S = {
    items: [], snaps: [], view: 'home', homeCat: 'all', period: '3M',
    listCat: 'all', q: '', sort: 'value', busy: false, progress: [0, 0],
    lastUpdate: null, usdRate: 0.86, installEvt: null, bgState: 'unknown'
  };

  // ---------- Utilitaires ----------
  const $ = id => document.getElementById(id);
  const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
  const fmt = n => eur.format(Number(n) || 0);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => { if (v == null || v === '') return null; const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : null; };
  const dLocal = iso => iso ? dFr(Core.today(new Date(iso))) : '';
  const dFr = iso => { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-'); return d + '/' + m + '/' + y; };
  const dShort = iso => { const [, m, d] = iso.slice(0, 10).split('-'); return d + '/' + m; };
  const uid = () => (self.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const pct = (a, b) => b ? ((a - b) / b) * 100 : null;
  function signed(n, isPct) {
    if (n == null || !isFinite(n)) return '';
    const s = n > 0 ? '+' : n < 0 ? '−' : '';
    return s + (isPct ? Math.abs(n).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' %' : fmt(Math.abs(n)));
  }
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2800);
  }
  function initials(s) { return esc(String(s || '?').trim().slice(0, 2).toUpperCase()); }

  // ---------- Chargement ----------
  async function load() {
    S.items = await Core.getAll('items');
    S.snaps = (await Core.getAll('snapshots')).sort((a, b) => a.date < b.date ? -1 : 1);
    S.lastUpdate = await Core.getMeta('lastUpdate', null);
    S.usdRate = await Core.getMeta('usdRate', 0.86);
  }
  async function saveItemAndSnapshot(it) {
    Core.stampHistory(it, Core.today());
    await Core.put('items', it);
    const all = await Core.getAll('items');
    await Core.writeSnapshot(all, Core.today());
    await load(); renderAll();
  }

  // ---------- Rendu général ----------
  function renderAll() { renderSync(); renderHome(); renderList(); renderSettings(); }

  function renderSync() {
    const dot = $('syncDot'), txt = $('syncText');
    dot.className = 'dot'; dot.hidden = false;
    if (S.busy) {
      dot.classList.add('busy');
      txt.textContent = 'Mise à jour… ' + S.progress[0] + '/' + S.progress[1];
      $('progress').style.width = S.progress[1] ? (100 * S.progress[0] / S.progress[1]) + '%' : '30%';
      return;
    }
    $('progress').style.width = '0';
    if (!S.lastUpdate) { txt.textContent = S.items.length ? 'Prix jamais mis à jour' : ''; if (S.items.length) dot.classList.add('warn'); else dot.hidden = true; return; }
    dot.hidden = false;
    const d = new Date(S.lastUpdate);
    const isToday = Core.today(d) === Core.today();
    if (!isToday) dot.classList.add('warn');
    txt.textContent = 'Prix du ' + (isToday ? "jour" : dFr(Core.today(d))) + ' · ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  // ---------- Accueil ----------
  function renderHome() {
    const t = Core.totals(S.items);
    const cat = S.homeCat;
    const val = cat === 'all' ? t.total : t[cat];
    $('heroLabel').textContent = cat === 'all' ? 'Valeur totale' : 'Valeur · ' + CATS[cat].label;
    $('heroTotal').textContent = fmt(val);

    // Variation depuis le point précédent et gain sur achats
    const key = cat === 'all' ? 'total' : cat;
    const sn = S.snaps;
    let deltaHTML = '';
    if (sn.length >= 2) {
      const prev = sn[sn.length - 2][key] || 0;
      const d = val - prev;
      const cls = d > 0 ? 'up' : d < 0 ? 'down' : 'muted';
      deltaHTML = '<span class="' + cls + '">' + (d === 0 ? 'Stable' : signed(d) + ' (' + signed(pct(val, prev), true) + ')') + '</span> <span class="muted">depuis le ' + dFr(sn[sn.length - 2].date) + '</span>';
    }
    if (cat === 'all' && t.cost > 0) {
      const g = t.costKnown - t.cost;
      deltaHTML += (deltaHTML ? '<br>' : '') + '<span class="muted">Plus-value sur achats : </span><span class="' + (g >= 0 ? 'up' : 'down') + '">' + signed(g) + ' (' + signed(pct(t.costKnown, t.cost), true) + ')</span>';
    }
    $('heroDelta').innerHTML = deltaHTML;

    // Tuiles catégories
    const count = c => S.items.filter(i => i.cat === c).reduce((a, i) => a + (Number(i.qty) || 1), 0);
    $('cats').innerHTML = Object.entries(CATS).map(([k, c]) =>
      '<button class="cat ' + c.cls + '" data-homecat="' + k + '" aria-pressed="' + (cat === k) + '">' +
      '<span class="label">' + c.label + '</span><span class="n">' + fmt(t[k]) + '</span><span class="s">' + count(k) + ' article' + (count(k) > 1 ? 's' : '') + '</span></button>'
    ).join('');

    // Périodes
    $('periods').innerHTML = PERIODS.map(([p]) => '<button class="chip" data-period="' + p + '" aria-pressed="' + (S.period === p) + '">' + p + '</button>').join('');
    $('chartLabel').textContent = cat === 'all' ? 'Évolution' : 'Évolution · ' + CATS[cat].label;

    const days = PERIODS.find(p => p[0] === S.period)[1];
    const from = days ? Core.today(new Date(Date.now() - days * 864e5)) : '0000';
    const pts = sn.filter(s => s.date >= from).map(s => ({ d: s.date, v: s[key] || 0 }));
    const color = cat === 'all' ? 'var(--accent)' : 'var(--' + cat + ')';
    drawChart($('chart'), pts, color);

    // Plus grosses valeurs
    const pool = S.items.filter(i => cat === 'all' || i.cat === cat).sort((a, b) => Core.lineValue(b) - Core.lineValue(a)).slice(0, 5);
    $('topList').innerHTML = pool.map(rowHTML).join('');
    $('topWrap').hidden = !pool.length;

    const he = $('homeEmpty');
    if (!S.items.length) {
      he.hidden = false;
      he.innerHTML = '<div class="empty"><h3>Ta collection est vide</h3><p>Ajoute ta première carte, carte gradée ou produit scellé avec le bouton +. Le total et le graphique se rempliront ensuite jour après jour.</p><button class="btn primary" data-action="add">Ajouter un article</button></div>';
    } else he.hidden = true;
  }

  // ---------- Graphique ----------
  function niceStep(range) {
    const raw = range / 3; const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const n = raw / mag; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  }
  function axisFmt(v, step) {
    const dec = s => Math.min(3, Math.max(0, -Math.floor(Math.log10(s) + 1e-9)));
    if (Math.abs(v) >= 1000 || step >= 1000) return (v / 1000).toLocaleString('fr-FR', { maximumFractionDigits: dec(step / 1000) }) + ' k€';
    return v.toLocaleString('fr-FR', { maximumFractionDigits: dec(step) }) + ' €';
  }
  let chartSeq = 0;
  const cv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888';
  function drawChart(el, pts, colorVar) {
    const color = cv(colorVar.replace(/^var\(|\)$/g, ''));
    const LINE = cv('--line'), MUTED = cv('--muted'), SURF = cv('--surface');
    if (!pts.length) { el.innerHTML = '<div class="chart-empty">Le graphique apparaîtra après le premier enregistrement de prix. Un point est ajouté chaque jour.</div>'; return; }
    const W = Math.max(280, Math.round(el.clientWidth || 340)), H = 170;
    const L = 52, R = 10, T = 22, B = 22;
    let lo = Math.min(...pts.map(p => p.v)), hi = Math.max(...pts.map(p => p.v));
    if (hi === lo) { const pad = Math.max(1, hi * 0.1); lo -= pad; hi += pad; }
    const step = niceStep(hi - lo);
    lo = Math.max(0, Math.floor(lo / step) * step); hi = Math.ceil(hi / step) * step;
    const x = i => pts.length === 1 ? L + (W - L - R) / 2 : L + i * (W - L - R) / (pts.length - 1);
    const y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
    const id = 'g' + (++chartSeq);
    let grid = '';
    for (let v = lo; v <= hi + step / 2; v += step) {
      grid += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="' + LINE + '" stroke-width="1"/>' +
        '<text x="' + (L - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end" font-size="11" fill="' + MUTED + '">' + axisFmt(v, step) + '</text>';
    }
    const line = pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.v).toFixed(1)).join(' ');
    const area = pts.length > 1 ? line + ' L' + x(pts.length - 1).toFixed(1) + ' ' + (H - B) + ' L' + x(0).toFixed(1) + ' ' + (H - B) + ' Z' : '';
    const last = pts[pts.length - 1];
    const xl = '<text x="' + x(0) + '" y="' + (H - 4) + '" font-size="11" fill="' + MUTED + '" text-anchor="' + (pts.length === 1 ? 'middle' : 'start') + '">' + dShort(pts[0].d) + '</text>' +
      (pts.length > 1 ? '<text x="' + x(pts.length - 1) + '" y="' + (H - 4) + '" font-size="11" fill="' + MUTED + '" text-anchor="end">' + dShort(last.d) + '</text>' : '');
    el.innerHTML =
      '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Évolution de la valeur">' +
      '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + color + '" stop-opacity=".28"/><stop offset="1" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>' +
      grid + (area ? '<path d="' + area + '" fill="url(#' + id + ')"/>' : '') +
      (pts.length > 1 ? '<path d="' + line + '" fill="none" stroke="' + color + '" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>' : '') +
      '<circle cx="' + x(pts.length - 1) + '" cy="' + y(last.v) + '" r="4.5" fill="' + color + '" stroke="' + SURF + '" stroke-width="2"/>' + xl +
      '<g class="scrub" visibility="hidden"><line y1="' + T + '" y2="' + (H - B) + '" stroke="' + MUTED + '" stroke-dasharray="3 3"/><circle r="4" fill="' + color + '"/></g>' +
      '<rect x="' + L + '" y="0" width="' + (W - L - R) + '" height="' + H + '" fill="transparent" class="hit"/></svg>' +
      '<div class="tip" hidden></div>' +
      (pts.length === 1 ? '<div class="chart-empty">Premier point enregistré aujourd\'hui. La courbe se dessinera dès demain.</div>' : '');
    const svg = el.querySelector('svg'), g = el.querySelector('.scrub'), tip = el.querySelector('.tip');
    const move = ev => {
      const r = svg.getBoundingClientRect();
      const sx = (ev.clientX - r.left) * (W / r.width);
      let i = pts.length === 1 ? 0 : Math.round((sx - L) / ((W - L - R) / (pts.length - 1)));
      i = Math.max(0, Math.min(pts.length - 1, i));
      const px = x(i), py = y(pts[i].v);
      g.setAttribute('visibility', 'visible');
      g.querySelector('line').setAttribute('x1', px); g.querySelector('line').setAttribute('x2', px);
      g.querySelector('circle').setAttribute('cx', px); g.querySelector('circle').setAttribute('cy', py);
      tip.hidden = false; tip.textContent = dFr(pts[i].d) + ' · ' + fmt(pts[i].v);
      tip.style.left = Math.min(Math.max(px * r.width / W, 70), r.width - 70) + 'px';
      tip.style.top = '-6px';
    };
    const hit = el.querySelector('.hit');
    hit.addEventListener('pointerdown', move); hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerleave', () => { g.setAttribute('visibility', 'hidden'); tip.hidden = true; });
  }

  // ---------- Lignes ----------
  function tagsFor(it) {
    const t = [];
    if (it.lang) t.push('<span class="tag">' + esc((LANG[it.lang] || {}).short || it.lang) + '</span>');
    if (it.cat === 'graded') t.push('<span class="tag grade">' + esc((it.grader || '') + ' ' + (it.grade || '')) + '</span>');
    if (it.cat === 'sealed' && it.sealedType) t.push('<span>' + esc(it.sealedType) + '</span>');
    if (it.setName) t.push('<span>' + esc(it.setName) + (it.number ? ' · ' + esc(it.number) : '') + '</span>');
    else if (it.number) t.push('<span>n° ' + esc(it.number) + '</span>');
    if ((it.priceMode === 'auto' || it.priceMode === 'coef') && it.autoPrice == null) t.push('<span class="tag warn">prix introuvable</span>');
    if (it.priceMode === 'manual' && it.manualPrice == null) t.push('<span class="tag warn">prix à saisir</span>');
    else if (it.priceMode === 'manual' && it.manualUpdated && (Date.now() - new Date(it.manualUpdated)) > 45 * 864e5) t.push('<span class="tag warn">prix à revoir</span>');
    return t.join('');
  }
  function thumbHTML(it, cls) {
    const c = CATS[it.cat].cls;
    if (it.image) return '<img class="' + (cls || 'thumb') + '" src="' + esc(it.image) + '" alt="" loading="lazy">';
    return '<div class="' + (cls || 'thumb') + (it.cat === 'sealed' ? ' sealed' : '') + ' ' + c + '"><span class="bar"></span>' + initials(it.name) + '</div>';
  }
  function rowHTML(it) {
    const q = Number(it.qty) || 1;
    return '<button class="row" data-open="' + esc(it.id) + '">' + thumbHTML(it) +
      '<span style="min-width:0;display:grid;gap:3px"><span class="t">' + esc(it.name) + '</span><span class="sub">' + tagsFor(it) + '</span></span>' +
      '<span class="v">' + fmt(Core.lineValue(it)) + (q > 1 ? '<small>' + q + ' × ' + fmt(Core.unitValue(it)) + '</small>' : '') + '</span></button>';
  }

  // ---------- Collection ----------
  function renderList() {
    $('seg').innerHTML = [['all', 'Tout']].concat(Object.entries(CATS).map(([k, c]) => [k, c.label]))
      .map(([k, l]) => '<button data-listcat="' + k + '" aria-pressed="' + (S.listCat === k) + '">' + l + '</button>').join('');
    const q = S.q.trim().toLowerCase();
    let arr = S.items.filter(i => S.listCat === 'all' || i.cat === S.listCat);
    if (q) arr = arr.filter(i => [i.name, i.setName, i.number, i.grader, i.grade, i.sealedType, i.cert, i.notes].join(' ').toLowerCase().includes(q));
    const gain = i => { const c = Core.lineCost(i); return c == null ? -Infinity : Core.lineValue(i) - c; };
    const sorters = {
      value: (a, b) => Core.lineValue(b) - Core.lineValue(a),
      name: (a, b) => String(a.name).localeCompare(String(b.name), 'fr'),
      recent: (a, b) => String(b.addedAt || '').localeCompare(String(a.addedAt || '')),
      gain: (a, b) => gain(b) - gain(a)
    };
    arr.sort(sorters[S.sort]);
    const t = Core.totals(arr);
    $('listSummary').textContent = arr.length ? t.count + ' article' + (t.count > 1 ? 's' : '') + ' · ' + fmt(t.total) : '';
    $('list').innerHTML = arr.map(rowHTML).join('');
    $('list').hidden = !arr.length;
    const le = $('listEmpty');
    le.hidden = !!arr.length;
    if (!arr.length) le.innerHTML = S.items.length
      ? '<div class="empty"><h3>Aucun résultat</h3><p>Rien ne correspond à ta recherche dans cette catégorie.</p></div>'
      : '<div class="empty"><h3>Rien pour l\'instant</h3><p>Commence par ajouter un article avec le bouton +.</p><button class="btn primary" data-action="add">Ajouter un article</button></div>';
  }

  // ---------- Réglages ----------
  function renderSettings() {
    $('setLast').textContent = S.lastUpdate ? 'Dernière mise à jour : ' + new Date(S.lastUpdate).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' }) : 'Aucune mise à jour pour l\'instant.';
    $('btnUpdate').disabled = S.busy;
    const r = $('usdRate'); if (document.activeElement !== r) r.value = S.usdRate;
    const bg = {
      on: 'Mise à jour automatique activée : les prix sont relevés une fois par jour, même appli fermée, quand le téléphone est en ligne. Android choisit le moment exact.',
      off: 'Les prix se mettent à jour automatiquement à la première ouverture de l\'appli chaque jour. Installe l\'appli sur l\'écran d\'accueil pour activer aussi la mise à jour appli fermée.',
      unknown: 'Les prix se mettent à jour automatiquement à la première ouverture de l\'appli chaque jour.'
    };
    $('bgStatus').textContent = bg[S.bgState] || bg.unknown;
    $('btnInstall').hidden = !S.installEvt;
  }

  // ---------- Mise à jour des prix ----------
  async function runUpdate(manual) {
    if (S.busy) return;
    if (!S.items.length) { if (manual) toast('Ajoute d\'abord un article.'); return; }
    S.busy = true; S.progress = [0, 0]; renderSync(); renderSettings();
    try {
      const r = await Core.updateAll({ onProgress: (d, n) => { S.progress = [d, n]; renderSync(); } });
      if (manual || r.fail) {
        if (r.linked === 0) toast('Valeur du jour enregistrée.');
        else if (r.fail && r.ok === 0) toast(navigator.onLine ? 'Prix indisponibles pour le moment. Réessaie plus tard.' : 'Pas de connexion : derniers prix connus conservés.');
        else toast(r.ok + ' prix mis à jour' + (r.fail ? ', ' + r.fail + ' introuvable' + (r.fail > 1 ? 's' : '') : ''));
      }
    } catch (e) {
      toast('La mise à jour a échoué. Réessaie plus tard.');
    }
    S.busy = false;
    await load(); renderAll();
  }

  // ---------- Feuilles (écrans superposés) ----------
  const stack = [];
  function openSheet(title, render) {
    stack.push({ title, render });
    history.pushState({ sheet: stack.length }, '');
    showTop();
  }
  function replaceSheet(title, render) { stack[stack.length - 1] = { title, render }; showTop(); }
  function showTop() {
    const top = stack[stack.length - 1];
    const sh = $('sheet');
    if (!top) { sh.hidden = true; document.body.style.overflow = ''; return; }
    sh.hidden = false; document.body.style.overflow = 'hidden';
    $('sheetTitle').textContent = top.title;
    const body = $('sheetBody'); body.innerHTML = '';
    const host = document.createElement('div'); host.className = 'sheet-inner';
    body.appendChild(host);
    top.render(host);
    sh.scrollTop = 0;
  }
  function closeAllSheets() { const n = stack.length; if (n) history.go(-n); }
  window.addEventListener('popstate', e => {
    const depth = (e.state && e.state.sheet) || 0;
    stack.length = Math.min(stack.length, depth);
    showTop();
  });
  $('sheetBack').addEventListener('click', () => history.back());

  // ---------- Détail ----------
  function marketLinks(it) {
    const langWord = { fr: 'FR', en: '', ja: 'japanese', 'zh-tw': 'chinese', 'zh-cn': 'chinese' }[it.lang] || '';
    const parts = [it.name];
    if (it.cat !== 'sealed' && it.number) parts.push(it.number);
    if (it.cat === 'graded') parts.push(it.grader !== 'Autre' ? it.grader : '', it.grade);
    if (it.cat === 'sealed') parts.push(it.setName || '');
    parts.push(langWord);
    const q = parts.filter(Boolean).join(' ');
    const ebay = 'https://www.ebay.fr/sch/i.html?_nkw=' + encodeURIComponent(q) + '&LH_Sold=1&LH_Complete=1&_sop=13';
    const cm = 'https://www.cardmarket.com/fr/Pokemon/Products/Search?searchString=' + encodeURIComponent(it.cat === 'sealed' ? (it.setName || it.name) : it.name);
    return '<div class="btnrow"><a class="btn" href="' + ebay + '" target="_blank" rel="noopener">Ventes eBay</a><a class="btn" href="' + cm + '" target="_blank" rel="noopener">Cardmarket</a></div>';
  }
  function showDetail(id) {
    openSheet('', body => renderDetail(body, id));
  }
  function renderDetail(body, id) {
    const it = S.items.find(i => i.id === id);
    if (!it) { body.innerHTML = '<div class="empty"><h3>Article introuvable</h3></div>'; return; }
    $('sheetTitle').textContent = CATS[it.cat].label;
    const q = Number(it.qty) || 1, unit = Core.unitValue(it), line = Core.lineValue(it), cost = Core.lineCost(it);
    let src = '';
    if (it.priceMode === 'auto') src = it.autoPrice != null ? 'Prix ' + esc(it.priceSource || 'Cardmarket') + ' · ' + dLocal(it.priceUpdated) : 'Pas de prix automatique trouvé' + (it.manualPrice != null ? ', prix saisi utilisé' : '');
    else if (it.priceMode === 'coef') src = it.autoPrice != null ? 'Prix carte ' + fmt(it.autoPrice) + ' × ' + String(it.coef).replace('.', ',') : 'Prix de la carte introuvable' + (it.manualPrice != null ? ', prix saisi utilisé' : '');
    else src = it.manualPrice != null ? 'Prix saisi' + (it.manualUpdated ? ' le ' + dLocal(it.manualUpdated) : '') : 'Aucun prix saisi';
    const gainHTML = cost != null ? '<div class="' + (line - cost >= 0 ? 'up' : 'down') + '" style="font-weight:600">' + signed(line - cost) + ' (' + signed(pct(line, cost), true) + ') sur le prix d\'achat</div>' : '';
    const img = it.image ? '<img src="' + esc(it.image.replace('/low.webp', '/high.webp')) + '" alt="">' : '<div class="ph' + (it.cat === 'sealed' ? ' sealed' : '') + '">' + initials(it.name) + '</div>';
    const facts = [];
    const f = (k, v) => { if (v != null && v !== '') facts.push('<div><span>' + k + '</span><b>' + esc(v) + '</b></div>'); };
    f('Langue', (LANG[it.lang] || {}).name);
    if (it.cat === 'sealed') f('Type', it.sealedType);
    f('Extension', it.setName); f('Numéro', it.number); f('Rareté', it.rarity);
    if (it.cat === 'graded') { f('Gradation', (it.grader || '') + ' ' + (it.grade || '')); f('N° de certificat', it.cert); }
    if (it.cat === 'raw' && it.tcgdexId) f('Version', it.variant === 'holo' ? 'Holo / reverse' : 'Normale');
    f('Quantité', String(q));
    f('Prix d\'achat (unité)', it.buyPrice != null ? fmt(it.buyPrice) : '');
    f('Date d\'achat', it.buyDate ? dFr(it.buyDate) : '');
    f('Prix unitaire', fmt(unit));
    if (facts.length % 2) facts.push('<div></div>');

    body.innerHTML =
      '<div class="detail-top">' + img + '<div style="display:grid;gap:6px;min-width:0">' +
      '<h3 style="font-size:19px">' + esc(it.name) + '</h3><div class="row" style="padding:0;border:0;display:block"><span class="sub">' + tagsFor(it) + '</span></div>' +
      '<div class="big">' + fmt(line) + '</div>' + (q > 1 ? '<div class="muted">' + q + ' × ' + fmt(unit) + '</div>' : '') +
      '<div class="muted" style="font-size:13px">' + src + '</div>' + gainHTML + '</div></div>' +
      '<div class="panel"><div class="chart-head"><div class="label">Historique du prix unitaire</div></div><div class="chart" id="itemChart"></div></div>' +
      '<div class="facts">' + facts.join('') + '</div>' +
      (it.notes ? '<div class="note">' + esc(it.notes) + '</div>' : '') +
      '<div style="display:grid;gap:6px"><span class="label">Vérifier le prix</span>' + marketLinks(it) + '</div>' +
      '<div class="btnrow"><button class="btn primary" id="dEdit">Modifier</button><button class="btn danger" id="dDel">Supprimer</button></div>' +
      '<div class="confirm" id="dConfirm" hidden><div>Supprimer « ' + esc(it.name) + ' » de ta collection ?</div><div class="btnrow"><button class="btn" id="dNo">Annuler</button><button class="btn danger solid" id="dYes">Supprimer</button></div></div>';
    const hp = (it.history || []).map(([d, v]) => ({ d, v }));
    drawChart($('itemChart'), hp, 'var(--' + it.cat + ')');
    $('dEdit').onclick = () => openSheet('Modifier', b => renderForm(b, JSON.parse(JSON.stringify(it)), true));
    $('dDel').onclick = () => { $('dConfirm').hidden = false; $('dConfirm').scrollIntoView({ block: 'nearest' }); };
    $('dNo').onclick = () => { $('dConfirm').hidden = true; };
    $('dYes').onclick = async () => {
      await Core.del('items', it.id);
      const all = await Core.getAll('items');
      await Core.writeSnapshot(all, Core.today());
      await load(); renderAll(); closeAllSheets(); toast('Article supprimé');
    };
  }

  // ---------- Ajout : étape 1 (catégorie) ----------
  function startAdd() {
    openSheet('Ajouter', body => {
      body.innerHTML = '<div class="label">Que veux-tu ajouter ?</div><div class="pick3">' +
        pick('raw', 'Carte', 'Carte non gradée, avec prix Cardmarket automatique') +
        pick('graded', 'Carte gradée', 'PSA, PCA, CCC, CGC… suit le prix de la carte') +
        pick('sealed', 'Produit scellé', 'Display, ETB, coffret, booster… prix Cardmarket automatique') + '</div>';
      body.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => {
        const cat = b.dataset.pick;
        const draft = newDraft(cat);
        if (cat === 'sealed') openSheet('Chercher le produit', bd => renderSealedSearch(bd, draft, false));
        else openSheet(cat === 'raw' ? 'Chercher la carte' : 'Chercher la carte gradée', bd => renderSearch(bd, draft, false));
      });
    });
    function pick(k, t, s) { return '<button class="pick ' + CATS[k].cls + '" data-pick="' + k + '"><span class="stripe"></span><span class="in"><b>' + t + '</b><span>' + s + '</span></span></button>'; }
  }
  function newDraft(cat) {
    return {
      id: null, cat, name: '', lang: 'fr', setName: '', number: '', rarity: '', image: '', tcgdexId: null, tcgdexLang: null,
      variant: 'normal', qty: 1, buyPrice: null, buyDate: '', notes: '', grader: 'PSA', grade: '10', cert: '',
      sealedType: SEALED_TYPES[0], cmId: null, priceMode: cat === 'raw' || cat === 'sealed' ? 'auto' : 'coef', coef: cat === 'graded' ? 3 : 1, manualPrice: null, history: []
    };
  }

  // ---------- Ajout : étape 2 (recherche TCGdex) ----------
  const lastSearch = { lang: 'fr', name: '', number: '' };
  function renderSearch(body, draft, isEdit) {
    body.innerHTML =
      '<label class="field"><span>Langue de la carte</span><select id="sLang">' + LANGS.map(l => '<option value="' + l.code + '"' + (l.code === (draft.lang || lastSearch.lang) ? ' selected' : '') + '>' + l.name + '</option>').join('') + '</select></label>' +
      '<form id="sForm" style="display:grid;gap:10px">' +
      '<div class="grid2"><label class="field" style="grid-column:span 2"><span>Nom du Pokémon ou de la carte</span><input type="text" id="sName" autocomplete="off" placeholder="ex. Dracaufeu, Pikachu, リザードン" value="' + esc(lastSearch.name) + '"></label></div>' +
      '<div class="grid2"><label class="field"><span>Numéro (optionnel)</span><input type="text" id="sNum" autocomplete="off" placeholder="ex. 199" value="' + esc(lastSearch.number) + '"></label>' +
      '<div class="field" style="align-content:end"><button class="btn primary" type="submit">Rechercher</button></div></div></form>' +
      '<div id="sMsg" class="muted" style="font-size:13.5px">Tape le nom tel qu\'il est écrit sur la carte, dans sa langue. Ajoute le numéro (sans « /165 ») pour réduire la liste.</div>' +
      '<div class="results" id="sRes"></div>' +
      '<button class="btn block" id="sManual">Je ne trouve pas ma carte : saisie manuelle</button>';
    const doSearch = async ev => {
      if (ev) ev.preventDefault();
      const lang = $('sLang').value, name = $('sName').value.trim(), number = $('sNum').value.trim();
      Object.assign(lastSearch, { lang, name, number });
      if (!name && !number) { $('sMsg').textContent = 'Indique au moins un nom ou un numéro.'; return; }
      $('sMsg').textContent = 'Recherche…'; $('sRes').innerHTML = '';
      try {
        let res = await Core.searchCards(lang, name, number);
        if (!Array.isArray(res)) res = [];
        if (!res.length) { $('sMsg').textContent = 'Aucune carte trouvée. Vérifie l\'orthographe, essaie sans le numéro, ou passe en saisie manuelle.'; return; }
        $('sMsg').textContent = res.length + ' résultat' + (res.length > 1 ? 's' : '') + (res.length >= 60 ? ' (les 60 premiers, précise ta recherche)' : '') + '. Touche ta carte.';
        $('sRes').innerHTML = res.map(c => '<button class="res" data-cid="' + esc(c.id) + '">' +
          (c.image ? '<img src="' + esc(Core.imageUrl(c.image, 'low')) + '" alt="" loading="lazy">' : '<span class="ph">Sans image</span>') +
          '<span class="nm">' + esc(c.name) + '</span><span class="id">' + esc(c.id) + '</span></button>').join('');
      } catch (e) {
        $('sMsg').textContent = e.status === 400 || e.status === 404
          ? 'Cette langue n\'est pas encore disponible dans la base TCGdex. Essaie une autre langue ou la saisie manuelle.'
          : 'La recherche a échoué. Vérifie ta connexion et réessaie.';
      }
    };
    $('sForm').addEventListener('submit', doSearch);
    $('sRes').addEventListener('click', async ev => {
      const b = ev.target.closest('[data-cid]'); if (!b) return;
      const lang = $('sLang').value;
      $('sMsg').textContent = 'Chargement de la carte…';
      try {
        const card = await Core.getCard(lang, b.dataset.cid);
        applyCard(draft, card, lang);
        const title = isEdit ? 'Modifier' : (draft.cat === 'raw' ? 'Carte' : 'Carte gradée');
        replaceSheet(title, bd => renderForm(bd, draft, isEdit));
      } catch (e) { $('sMsg').textContent = 'Impossible de charger cette carte. Réessaie.'; }
    });
    $('sManual').onclick = () => {
      draft.tcgdexId = null; draft._card = null; draft.image = draft.image && draft.tcgdexId ? draft.image : '';
      draft.lang = $('sLang').value;
      if (draft.cat === 'raw') draft.priceMode = 'manual';
      if (draft.cat === 'graded' && draft.priceMode === 'coef') draft.priceMode = 'manual';
      replaceSheet(isEdit ? 'Modifier' : 'Saisie manuelle', bd => renderForm(bd, draft, isEdit));
    };
    if (lastSearch.name || lastSearch.number) doSearch();
  }
  function applyCard(draft, card, lang) {
    draft._card = card;
    draft.tcgdexId = card.id; draft.tcgdexLang = lang; draft.lang = lang;
    draft.name = card.name || draft.name;
    draft.setName = (card.set && card.set.name) || '';
    draft.number = card.localId || '';
    if (card.set && card.set.cardCount && card.set.cardCount.official && /^\d+$/.test(String(card.localId))) draft.number = card.localId + '/' + card.set.cardCount.official;
    draft.rarity = card.rarity || '';
    draft.image = card.image ? Core.imageUrl(card.image, 'low') : '';
    const v = card.variants || {};
    draft.variant = (v.normal === false && (v.holo || v.reverse)) ? 'holo' : (draft.variant || 'normal');
    if (draft.cat === 'raw') draft.priceMode = 'auto';
  }

  // ---------- Ajout : recherche d'un produit scellé (catalogue Cardmarket) ----------
  const FR_EN = [
    ['coffret dresseur d elite', 'elite trainer box'], ['dresseur d elite', 'elite trainer box'], ['etb', 'elite trainer box'],
    ['display', 'booster box'], ['boite de boosters', 'booster box'], ['tripack', '3 pack'], ['tri pack', '3 pack'],
    ['pokebox', 'tin'], ['mini tin', 'mini tin'], ['coffret collection premium', 'premium collection'], ['coffret', 'box'],
    ['ecarlate et violet', 'scarlet violet'], ['epee et bouclier', 'sword shield'], ['soleil et lune', 'sun moon'],
    ['mega evolution', 'mega evolution'], ['evolutions prismatiques', 'prismatic evolutions'], ['flammes obsidiennes', 'obsidian flames'],
    ['destinees de paldea', 'paldean fates'], ['evolutions a paldea', 'paldea evolved'], ['faille paradoxe', 'paradox rift'],
    ['forces temporelles', 'temporal forces'], ['mascarade crepusculaire', 'twilight masquerade'], ['fable nebuleuse', 'shrouded fable'],
    ['couronne stellaire', 'stellar crown'], ['etincelles deferlantes', 'surging sparks'], ['aventures ensemble', 'journey together'],
    ['rivalites destinees', 'destined rivals'], ['foudre noire', 'black bolt'], ['flamme blanche', 'white flare'],
    ['zenith supreme', 'crown zenith'], ['origine perdue', 'lost origin'], ['tempete argentee', 'silver tempest'],
    ['astres radieux', 'astral radiance'], ['stars etincelantes', 'brilliant stars'], ['poing de fusion', 'fusion strike'],
    ['evolution celeste', 'evolving skies'], ['regne de glace', 'chilling reign'], ['styles de combat', 'battle styles'],
    ['destinees radieuses', 'shining fates'], ['voltage eclatant', 'vivid voltage'], ['tenebres embrasees', 'darkness ablaze'],
    ['clash des rebelles', 'rebel clash'], ['la voie du maitre', 'champion s path'], ['celebrations', 'celebrations']
  ];
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  function sealedMatch(rows, query) {
    let q = ' ' + norm(query) + ' ';
    for (const [fr, en] of FR_EN) q = q.replace(' ' + fr + ' ', ' ' + en + ' ');
    const toks = q.trim().split(' ').filter(Boolean);
    if (!toks.length) return [];
    const out = [];
    for (const r of rows) {
      const hay = ' ' + norm(r[1] + ' ' + r[2]) + ' ';
      if (toks.every(t => hay.includes(t))) { out.push(r); if (out.length >= 80) break; }
    }
    return out;
  }
  function renderSealedSearch(body, draft, isEdit) {
    body.innerHTML =
      '<form id="pForm" class="searchrow"><input type="search" id="pQ" autocomplete="off" placeholder="ex. display 151, ETB flammes obsidiennes" value="' + esc(draft._q || '') + '" aria-label="Nom du produit"><button class="btn primary" type="submit">Chercher</button></form>' +
      '<div id="pMsg" class="muted" style="font-size:13.5px">Chargement du catalogue Cardmarket…</div>' +
      '<div class="list" id="pRes" hidden></div>' +
      '<button class="btn block" id="pManual">Je ne trouve pas mon produit : saisie manuelle</button>';
    let rows = null, prices = null;
    const show = () => {
      if (!rows) return;
      const q = $('pQ').value.trim(); draft._q = q;
      if (!q) { $('pMsg').textContent = 'Tape le type et l\'extension, en français ou en anglais : « display 151 », « ETB évolutions prismatiques », « booster box surging sparks ».'; $('pRes').hidden = true; return; }
      const res = sealedMatch(rows, q);
      if (!res.length) { $('pMsg').textContent = 'Aucun produit trouvé. Essaie le nom anglais de l\'extension, moins de mots, ou la saisie manuelle.'; $('pRes').hidden = true; return; }
      $('pMsg').textContent = res.length >= 80 ? 'Plus de 80 résultats : ajoute un mot pour préciser.' : res.length + ' résultat' + (res.length > 1 ? 's' : '') + '. Touche ton produit.';
      $('pRes').hidden = false;
      $('pRes').innerHTML = res.map(r => {
        const pr = Core.cmPrice(prices, r[0]);
        return '<button class="row" data-pid="' + r[0] + '" style="grid-template-columns:minmax(0,1fr) auto"><span style="min-width:0;display:grid;gap:2px"><span class="t" style="white-space:normal">' + esc(r[1]) + '</span><span class="sub">' + esc(r[2]) + '</span></span><span class="v">' + (pr ? fmt(pr.price) : '<small>sans prix</small>') + '</span></button>';
      }).join('');
    };
    $('pForm').addEventListener('submit', e => { e.preventDefault(); show(); });
    let t; $('pQ').addEventListener('input', () => { clearTimeout(t); t = setTimeout(show, 200); });
    $('pRes').addEventListener('click', e => {
      const b = e.target.closest('[data-pid]'); if (!b) return;
      const r = rows.find(x => String(x[0]) === b.dataset.pid); if (!r) return;
      draft.cmId = r[0]; draft.name = r[1]; draft.sealedType = r[2] || draft.sealedType;
      draft._cmPrice = Core.cmPrice(prices, r[0]);
      if (draft.priceMode === 'manual' && !isEdit) draft.priceMode = 'auto';
      if (!isEdit) draft.priceMode = 'auto';
      replaceSheet(isEdit ? 'Modifier' : 'Produit scellé', bd => renderForm(bd, draft, isEdit));
    });
    $('pManual').onclick = () => {
      draft.cmId = null; draft._cmPrice = null; draft.priceMode = 'manual';
      replaceSheet(isEdit ? 'Modifier' : 'Saisie manuelle', bd => renderForm(bd, draft, isEdit));
    };
    Promise.all([Core.cmLoadCatalogue(), Core.cmLoadPrices().catch(() => null)]).then(([cat, pr]) => {
      rows = (cat && cat.rows) || []; prices = pr;
      show(); $('pQ').focus();
    }).catch(() => {
      $('pMsg').textContent = 'Le catalogue des produits scellés n\'est pas encore disponible. Il est créé par la mise à jour quotidienne sur GitHub (voir le guide, étape « Prix du jour »). En attendant, utilise la saisie manuelle.';
    });
  }

  // ---------- Ajout / modification : formulaire ----------
  function renderForm(body, d, isEdit) {
    const card = d._card;
    const linked = !!d.tcgdexId;
    const pN = card ? Core.priceFromCard(card, 'normal', S.usdRate) : null;
    const pH = card ? Core.priceFromCard(card, 'holo', S.usdRate) : null;
    const cmLinked = d.cat === 'sealed' && !!d.cmId;
    const cmP = cmLinked ? (d._cmPrice !== undefined ? d._cmPrice : (d.autoPrice != null ? { price: d.autoPrice } : null)) : null;
    const curAuto = card ? (Core.priceFromCard(card, d.variant, S.usdRate) || {}).price : cmLinked ? (cmP ? cmP.price : null) : d.autoPrice;
    let h = '';

    if (d.cat !== 'sealed') {
      if (linked) {
        h += '<div class="chosen">' + (d.image ? '<img src="' + esc(d.image) + '" alt="">' : '<div class="ph"></div>') +
          '<div class="kv"><b>' + esc(d.name) + '</b><span>' + esc(d.setName) + ' · ' + esc(d.number) + '</span>' +
          (d.rarity ? '<span class="muted">' + esc(d.rarity) + '</span>' : '') + '<span class="muted">' + esc((LANG[d.lang] || {}).name || '') + '</span>' +
          (card ? '<span style="margin-top:4px">' + (pN || pH ? 'Cardmarket : ' + (pN ? fmt(pN.price) + ' normale' : '') + (pN && pH && pH.price !== pN.price ? ' · ' : '') + (pH && (!pN || pH.price !== pN.price) ? fmt(pH.price) + ' holo/reverse' : '') : '<span class="muted">Pas de prix Cardmarket pour cette carte</span>') + '</span>' : '') +
          '<button class="btn" type="button" id="fChange" style="justify-self:start;margin-top:6px;min-height:36px;padding:6px 12px">Changer de carte</button></div></div>';
      } else {
        h += '<label class="field"><span>Nom de la carte</span><input type="text" id="fName" value="' + esc(d.name) + '" placeholder="ex. Dracaufeu ex"></label>' +
          '<div class="grid2"><label class="field"><span>Extension</span><input type="text" id="fSet" value="' + esc(d.setName) + '" placeholder="ex. 151"></label>' +
          '<label class="field"><span>Numéro</span><input type="text" id="fNum" value="' + esc(d.number) + '" placeholder="ex. 199/165"></label></div>' +
          '<label class="field"><span>Langue</span><select id="fLang">' + LANGS.map(l => '<option value="' + l.code + '"' + (l.code === d.lang ? ' selected' : '') + '>' + l.name + '</option>').join('') + '</select></label>' +
          '<button class="btn" type="button" id="fChange">Chercher la carte dans la base (prix automatique)</button>';
      }
    }

    if (d.cat === 'sealed' && cmLinked) {
      h += '<div class="panel" style="display:grid;gap:4px"><b style="font-size:16px">' + esc(d.name) + '</b><span class="muted">' + esc(d.sealedType || '') + '</span>' +
        '<span>' + (cmP ? 'Cardmarket aujourd\'hui : ' + fmt(cmP.price) : '<span class="muted">Pas de prix Cardmarket pour ce produit pour l\'instant</span>') + '</span>' +
        '<button class="btn" type="button" id="fChange" style="justify-self:start;margin-top:6px;min-height:36px;padding:6px 12px">Changer de produit</button></div>' +
        '<label class="field"><span>Langue</span><select id="fLang">' + LANGS.map(l => '<option value="' + l.code + '"' + (l.code === d.lang ? ' selected' : '') + '>' + l.name + '</option>').join('') + '</select></label>';
    } else if (d.cat === 'sealed') {
      h += '<button class="btn" type="button" id="fChange">Chercher le produit dans le catalogue (prix automatique)</button>' +
        '<label class="field"><span>Type de produit</span><select id="fSType">' + SEALED_TYPES.map(t => '<option' + (t === d.sealedType ? ' selected' : '') + '>' + esc(t) + '</option>').join('') + '</select></label>' +
        '<label class="field"><span>Nom du produit</span><input type="text" id="fName" value="' + esc(d.name) + '" placeholder="ex. Display Écarlate et Violet 151"></label>' +
        '<label class="field"><span>Extension</span><input type="text" id="fSet" value="' + esc(d.setName) + '" placeholder="ex. 151"></label>' +
        '<label class="field"><span>Langue</span><select id="fLang">' + LANGS.map(l => '<option value="' + l.code + '"' + (l.code === d.lang ? ' selected' : '') + '>' + l.name + '</option>').join('') + '</select></label>';
    }

    if (d.cat === 'graded') {
      h += '<div class="grid2"><label class="field"><span>Société</span><select id="fGrader">' + GRADERS.map(g => '<option' + (g === d.grader ? ' selected' : '') + '>' + g + '</option>').join('') + '</select></label>' +
        '<label class="field"><span>Note</span><select id="fGrade">' + GRADES.map(g => '<option' + (g === String(d.grade) ? ' selected' : '') + '>' + g + '</option>').join('') + '</select></label></div>' +
        '<label class="field"><span>N° de certificat (optionnel)</span><input type="text" id="fCert" value="' + esc(d.cert) + '" inputmode="numeric"></label>';
    }

    // Version (holo) pour les cartes liées
    if (linked && d.cat !== 'sealed') {
      h += '<div class="field"><span>Version</span><div class="radio">' +
        radio('fVar', 'normal', d.variant, 'Normale', pN ? fmt(pN.price) : '') +
        radio('fVar', 'holo', d.variant, 'Holo ou reverse', pH ? fmt(pH.price) : '') + '</div></div>';
    }

    // Mode de prix
    const modes = [];
    if (d.cat === 'raw') {
      if (linked) modes.push(['auto', 'Automatique', 'Prix tendance Cardmarket, mis à jour chaque jour']);
      if (linked) modes.push(['coef', 'Automatique × coefficient', 'Pour une langue qui se vend plus ou moins cher. Ex. ×1,2 = 20 % de plus']);
      modes.push(['manual', 'Je saisis le prix', 'Le prix reste fixe jusqu\'à ta prochaine modification']);
    } else if (d.cat === 'graded') {
      if (linked) modes.push(['coef', 'Automatique : prix de la carte × coefficient', 'Tu indiques une fois ce que vaut ta gradée, ensuite elle suit le marché chaque jour']);
      modes.push(['manual', 'Je saisis le prix', 'Le prix reste fixe jusqu\'à ta prochaine modification']);
    } else if (d.cat === 'sealed') {
      if (cmLinked) modes.push(['auto', 'Automatique', 'Prix tendance Cardmarket, mis à jour chaque jour']);
      if (cmLinked) modes.push(['coef', 'Automatique × coefficient', 'Si la version française se vend plus ou moins cher. Ex. ×1,15 = 15 % de plus']);
      modes.push(['manual', 'Je saisis le prix', 'Le prix reste fixe jusqu\'à ta prochaine modification']);
    }
    if (!modes.some(m => m[0] === d.priceMode)) d.priceMode = modes[0][0];
    if (modes.length > 1) h += '<div class="field"><span>Prix</span><div class="radio">' + modes.map(m => radio('fMode', m[0], d.priceMode, m[1], m[2])).join('') + '</div></div>';
    else d.priceMode = modes.length ? modes[0][0] : 'manual';

    if (d.cat === 'graded') h += '<label class="field" id="wGVal"><span>Combien vaut ta carte gradée aujourd\'hui ? (€)</span><input type="text" inputmode="decimal" id="fGVal" placeholder="ex. 350, d\'après une vente eBay récente"><small>Le coefficient se calcule tout seul. Tu n\'auras plus à y toucher.</small></label>';
    h += '<label class="field" id="wCoef"><span>Coefficient</span><input type="text" inputmode="decimal" id="fCoef" value="' + esc(String(d.coef).replace('.', ',')) + '"><small id="coefHint"></small></label>';
    h += '<label class="field" id="wManual"><span id="manualLbl">Prix actuel (unité, en €)</span><input type="text" inputmode="decimal" id="fManual" value="' + (d.manualPrice != null ? esc(String(d.manualPrice).replace('.', ',')) : '') + '" placeholder="ex. 120"><small id="manualHint"></small></label>';

    h += '<div class="grid2"><label class="field"><span>Quantité</span><input type="number" min="1" step="1" id="fQty" value="' + (Number(d.qty) || 1) + '" inputmode="numeric"></label>' +
      '<label class="field"><span>Prix d\'achat (unité)</span><input type="text" inputmode="decimal" id="fBuy" value="' + (d.buyPrice != null ? esc(String(d.buyPrice).replace('.', ',')) : '') + '" placeholder="optionnel"></label></div>' +
      '<label class="field"><span>Date d\'achat (optionnel)</span><input type="date" id="fBuyDate" value="' + esc(d.buyDate || '') + '"></label>' +
      '<label class="field"><span>Notes (optionnel)</span><textarea id="fNotes" placeholder="état, provenance, emplacement…">' + esc(d.notes) + '</textarea></label>' +
      '<div id="fErr" class="down" style="font-weight:600" hidden></div>' +
      '<button class="btn primary block" id="fSave">' + (isEdit ? 'Enregistrer' : 'Ajouter à ma collection') + '</button>';
    body.innerHTML = h;

    const val = id => { const e = $(id); return e ? e.value : undefined; };
    const getRadio = n => { const e = body.querySelector('input[name="' + n + '"]:checked'); return e ? e.value : null; };
    function sync() {
      const mode = getRadio('fMode') || d.priceMode;
      const variant = getRadio('fVar') || d.variant;
      const auto = card ? (Core.priceFromCard(card, variant, S.usdRate) || {}).price : curAuto;
      $('wCoef').hidden = mode !== 'coef';
      if ($('wGVal')) {
        $('wGVal').hidden = mode !== 'coef' || auto == null;
        const gv = num(val('fGVal'));
        if (gv && auto && document.activeElement === $('fGVal')) $('fCoef').value = String(Core.round2(gv / auto)).replace('.', ',');
      }
      $('wManual').hidden = false;
      if (mode === 'coef') {
        const c = num(val('fCoef')) || 1;
        $('coefHint').textContent = auto != null ? (d.cat === 'sealed' ? 'Prix Cardmarket ' : 'Prix de la carte ') + fmt(auto) + ' × ' + String(c).replace('.', ',') + ' = ' + fmt(auto * c) + ' aujourd\'hui' : 'Pas de prix automatique : le prix saisi ci-dessous sera utilisé.';
        $('manualLbl').textContent = 'Prix de secours (unité, en €, optionnel)';
        $('manualHint').textContent = 'Utilisé seulement si le prix automatique est introuvable.';
      } else if (mode === 'auto') {
        $('manualLbl').textContent = 'Prix de secours (unité, en €, optionnel)';
        $('manualHint').textContent = auto != null ? 'Prix automatique aujourd\'hui : ' + fmt(auto) + '. Ce champ sert seulement si le prix devient introuvable.' : 'Pas de prix automatique pour cette carte : saisis un prix ici.';
      } else {
        $('manualLbl').textContent = 'Prix actuel (unité, en €)';
        $('manualHint').textContent = d.cat === 'sealed' ? 'Astuce : compare les offres Cardmarket en français et les ventes eBay terminées.' : d.cat === 'graded' ? 'Astuce : regarde les ventes eBay terminées pour la même société et la même note.' : '';
      }
    }
    body.addEventListener('change', sync); body.addEventListener('input', sync); sync();

    const ch = $('fChange');
    if (ch) ch.onclick = () => {
      collect();
      if (d.cat === 'sealed') replaceSheet('Chercher le produit', bd => renderSealedSearch(bd, d, isEdit));
      else replaceSheet(d.cat === 'raw' ? 'Chercher la carte' : 'Chercher la carte gradée', bd => renderSearch(bd, d, isEdit));
    };

    function collect() {
      if (val('fName') !== undefined) d.name = val('fName').trim();
      if (val('fSet') !== undefined) d.setName = val('fSet').trim();
      if (val('fNum') !== undefined) d.number = val('fNum').trim();
      if (val('fLang') !== undefined) d.lang = val('fLang');
      if (val('fSType') !== undefined) d.sealedType = val('fSType');
      if (val('fGrader') !== undefined) d.grader = val('fGrader');
      if (val('fGrade') !== undefined) d.grade = val('fGrade');
      if (val('fCert') !== undefined) d.cert = val('fCert').trim();
      d.variant = getRadio('fVar') || d.variant;
      d.priceMode = getRadio('fMode') || d.priceMode;
      d.coef = num(val('fCoef')) || d.coef || 1;
      d.qty = Math.max(1, parseInt(val('fQty'), 10) || 1);
      d.buyPrice = num(val('fBuy'));
      d.buyDate = val('fBuyDate') || '';
      d.notes = val('fNotes').trim();
      d._newManual = num(val('fManual'));
    }

    $('fSave').onclick = async () => {
      collect();
      const err = $('fErr');
      if (!d.name) { err.hidden = false; err.textContent = 'Indique un nom.'; return; }
      if (d.priceMode === 'manual' && d._newManual == null) { err.hidden = false; err.textContent = 'Indique le prix actuel (tu pourras le modifier plus tard).'; return; }
      if (d.priceMode !== 'manual' && curAuto == null && !card && d._newManual == null) { err.hidden = false; err.textContent = 'Pas encore de prix automatique : indique un prix de secours.'; return; }
      const it = Object.assign({}, d);
      if (it._newManual !== it.manualPrice) it.manualUpdated = new Date().toISOString();
      it.manualPrice = it._newManual;
      if (card) {
        const pr = Core.priceFromCard(card, it.variant, S.usdRate);
        if (pr) { it.autoPrice = pr.price; it.priceSource = pr.source; it.priceUpdated = pr.updated || new Date().toISOString(); it.priceStatus = 'ok'; }
        else { it.autoPrice = null; it.priceStatus = 'none'; }
      }
      if (it.cmId && it.cat === 'sealed') {
        const pr = it._cmPrice !== undefined ? it._cmPrice : (it.autoPrice != null ? { price: it.autoPrice, source: it.priceSource, updated: it.priceUpdated } : null);
        if (pr) { it.autoPrice = pr.price; it.priceSource = 'Cardmarket'; it.priceUpdated = pr.updated || new Date().toISOString(); it.priceStatus = 'ok'; }
        else { it.autoPrice = null; it.priceStatus = 'none'; }
      }
      if (!it.tcgdexId && !it.cmId) { it.autoPrice = null; it.priceMode = 'manual'; }
      delete it._card; delete it._newManual; delete it._cmPrice; delete it._q;
      if (!it.id) { it.id = uid(); it.addedAt = new Date().toISOString(); it.history = []; }
      await saveItemAndSnapshot(it);
      closeAllSheets();
      toast(isEdit ? 'Modifications enregistrées' : 'Ajouté à ta collection');
    };
  }
  function radio(name, value, cur, title, sub) {
    return '<label><input type="radio" name="' + name + '" value="' + value + '"' + (value === cur ? ' checked' : '') + '><span><b>' + esc(title) + '</b>' + (sub ? '<em>' + esc(sub) + '</em>' : '') + '</span></label>';
  }

  // ---------- Sauvegarde ----------
  async function exportData() {
    const data = {
      app: 'collection-pokemon', version: 1, exportedAt: new Date().toISOString(),
      items: await Core.getAll('items'), snapshots: await Core.getAll('snapshots'), usdRate: S.usdRate
    };
    const name = 'collection-pokemon-' + Core.today() + '.json';
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    try {
      const file = new File([blob], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Sauvegarde collection' }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('Sauvegarde téléchargée');
  }
  function importData(file) {
    const r = new FileReader();
    r.onload = () => {
      let data;
      try { data = JSON.parse(r.result); } catch (e) { toast('Ce fichier n\'est pas une sauvegarde valide.'); return; }
      if (!data || data.app !== 'collection-pokemon' || !Array.isArray(data.items)) { toast('Ce fichier n\'est pas une sauvegarde de cette appli.'); return; }
      openSheet('Importer', body => {
        body.innerHTML = '<div class="confirm"><div>Remplacer ta collection actuelle (' + S.items.length + ' article' + (S.items.length > 1 ? 's' : '') + ') par la sauvegarde du ' + dLocal(data.exportedAt) + ' (' + data.items.length + ' article' + (data.items.length > 1 ? 's' : '') + ', ' + (data.snapshots || []).length + ' jours d\'historique) ?</div>' +
          '<div class="btnrow"><button class="btn" id="iNo">Annuler</button><button class="btn danger solid" id="iYes">Remplacer</button></div></div>';
        $('iNo').onclick = () => history.back();
        $('iYes').onclick = async () => {
          await Core.clear('items'); await Core.clear('snapshots');
          await Core.putMany('items', data.items);
          if (Array.isArray(data.snapshots)) await Core.putMany('snapshots', data.snapshots);
          if (data.usdRate) await Core.setMeta('usdRate', data.usdRate);
          await load(); renderAll(); closeAllSheets(); toast('Sauvegarde importée');
        };
      });
    };
    r.readAsText(file);
  }

  // ---------- Navigation & événements ----------
  function go(view) {
    S.view = view;
    ['home', 'list', 'settings'].forEach(v => { $('v-' + v).hidden = v !== view; });
    document.querySelectorAll('.nav [data-go]').forEach(b => b.setAttribute('aria-current', b.dataset.go === view ? 'page' : 'false'));
    window.scrollTo(0, 0);
    if (view === 'home') renderHome();
  }
  document.addEventListener('click', ev => {
    const t = ev.target.closest('[data-go],[data-homecat],[data-period],[data-listcat],[data-open],[data-action]');
    if (!t) return;
    if (t.dataset.go) go(t.dataset.go);
    else if (t.dataset.homecat) { S.homeCat = S.homeCat === t.dataset.homecat ? 'all' : t.dataset.homecat; renderHome(); }
    else if (t.dataset.period) { S.period = t.dataset.period; renderHome(); }
    else if (t.dataset.listcat) { S.listCat = t.dataset.listcat; renderList(); }
    else if (t.dataset.open) showDetail(t.dataset.open);
    else if (t.dataset.action === 'add') startAdd();
  });
  $('btnAdd').onclick = startAdd;
  $('q').addEventListener('input', e => { S.q = e.target.value; renderList(); });
  $('sort').addEventListener('change', e => { S.sort = e.target.value; renderList(); });
  $('btnUpdate').onclick = () => runUpdate(true);
  $('btnExport').onclick = exportData;
  $('importFile').addEventListener('change', e => { const f = e.target.files[0]; if (f) importData(f); e.target.value = ''; });
  $('usdRate').addEventListener('change', async e => { const v = num(e.target.value); if (v && v > 0) { S.usdRate = v; await Core.setMeta('usdRate', v); toast('Taux enregistré'); } });
  $('btnWipe').onclick = () => { $('wipeConfirm').hidden = false; };
  $('wipeNo').onclick = () => { $('wipeConfirm').hidden = true; };
  $('wipeYes').onclick = async () => { await Core.clear('items'); await Core.clear('snapshots'); await Core.setMeta('lastUpdate', null); await Core.setMeta('lastUpdateDay', null); $('wipeConfirm').hidden = true; await load(); renderAll(); toast('Collection effacée'); };
  $('btnInstall').onclick = async () => { if (!S.installEvt) return; S.installEvt.prompt(); try { await S.installEvt.userChoice; } catch (e) {} S.installEvt = null; renderSettings(); };
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; renderSettings(); });
  let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (S.view === 'home') renderHome(); }, 150); });

  // ---------- Service worker & mise à jour quotidienne ----------
  async function setupBackground() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      navigator.serviceWorker.addEventListener('message', async e => { if (e.data && e.data.type === 'updated') { await load(); renderAll(); } });
      const ready = await navigator.serviceWorker.ready;
      if ('periodicSync' in ready) {
        let state = 'prompt';
        try { state = (await navigator.permissions.query({ name: 'periodic-background-sync' })).state; } catch (e) {}
        if (state === 'granted') {
          await ready.periodicSync.register('maj-prix', { minInterval: 24 * 60 * 60 * 1000 });
          S.bgState = 'on';
        } else S.bgState = 'off';
      } else S.bgState = 'unknown';
    } catch (e) { S.bgState = 'unknown'; }
    renderSettings();
  }

  async function start() {
    try { await load(); } catch (e) { toast('Stockage indisponible sur ce navigateur.'); }
    renderAll();
    setupBackground();
    const lastDay = await Core.getMeta('lastUpdateDay', null).catch(() => null);
    if (S.items.length && lastDay !== Core.today()) runUpdate(false);
  }
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || S.busy) return;
    const lastDay = await Core.getMeta('lastUpdateDay', null).catch(() => null);
    if (S.items.length && lastDay !== Core.today()) runUpdate(false); else { await load(); renderAll(); }
  });
  start();
})();
