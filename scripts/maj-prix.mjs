// Télécharge chaque jour le guide des prix Cardmarket (fichiers publics gratuits)
// et prépare deux petits fichiers pour l'appli :
//   data/scelle.json : catalogue des produits scellés Pokémon
//   data/prix.json   : prix du jour des produits scellés
// Usage : node scripts/maj-prix.mjs [dossier-source-local]
import { mkdir, writeFile, readFile } from 'node:fs/promises';

const GAME = 6; // 6 = Pokémon sur Cardmarket
const BASE = 'https://downloads.s3.cardmarket.com/productCatalog';
const URLS = {
  products: `${BASE}/productList/products_nonsingles_${GAME}.json`,
  prices: `${BASE}/priceGuide/price_guide_${GAME}.json`
};
const local = process.argv[2];

async function load(kind) {
  if (local) return JSON.parse(await readFile(`${local}/${kind}.json`, 'utf8'));
  const r = await fetch(URLS[kind], { headers: { 'User-Agent': 'ma-collection-pokemon (usage personnel)' } });
  if (!r.ok) throw new Error(`${URLS[kind]} -> HTTP ${r.status}`);
  return r.json();
}

// Trouve le tableau d'objets qui contient idProduct, quel que soit le nom de la clé.
function rowsOf(json) {
  if (Array.isArray(json)) return json;
  for (const v of Object.values(json || {})) {
    if (Array.isArray(v) && v.length && typeof v[0] === 'object' && v[0] && 'idProduct' in v[0]) return v;
  }
  throw new Error('Format inattendu : aucun tableau avec idProduct');
}
const n = v => (typeof v === 'number' && v > 0 ? Math.round(v * 100) / 100 : null);

const [prodJson, priceJson] = await Promise.all([load('products'), load('prices')]);
const products = rowsOf(prodJson);
const prices = rowsOf(priceJson);

const ids = new Set();
const catalogue = [];
for (const p of products) {
  if (!p.idProduct || !p.name) continue;
  ids.add(p.idProduct);
  const cat = String(p.categoryName || '').replace(/^Pok[ée]mon\s+/i, '');
  catalogue.push([p.idProduct, p.name, cat, p.idExpansion || 0, (p.dateAdded || '').slice(0, 10)]);
}
catalogue.sort((a, b) => (b[4] || '').localeCompare(a[4] || '') || b[0] - a[0]);

const p = {};
let withPrice = 0;
for (const g of prices) {
  if (!ids.has(g.idProduct)) continue;
  const row = [n(g.trend), n(g.avg7), n(g.avg30), n(g.low), n(g.avg)];
  if (row.some(x => x != null)) { p[g.idProduct] = row; withPrice++; }
}

const date = new Date().toISOString().slice(0, 10);
const source = priceJson.createdAt || null;
await mkdir('data', { recursive: true });
await writeFile('data/scelle.json', JSON.stringify({ date, fields: ['id', 'nom', 'type', 'extension', 'ajout'], rows: catalogue }));
await writeFile('data/prix.json', JSON.stringify({ date, source, fields: ['trend', 'avg7', 'avg30', 'low', 'avg'], p }));
console.log(`${catalogue.length} produits scellés, ${withPrice} avec un prix (source ${source || 'inconnue'})`);
if (!catalogue.length) process.exit(1);
