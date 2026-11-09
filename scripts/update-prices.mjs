// Refreshes prices.json with the nearby futures price for each crop.
// Run by .github/workflows/update-prices.yml each weekday after the grain markets close.
// The page reads prices.json and sets each crop's sell price = futures + that crop's basis.
import { readFile, writeFile } from 'node:fs/promises';

const MARKETS = {
  corn: { symbol: 'ZC=F', label: 'Corn', unit: 'bu' },
  soybeans: { symbol: 'ZS=F', label: 'Soybeans', unit: 'bu' },
  wheat: { symbol: 'ZW=F', label: 'Chicago SRW wheat', unit: 'bu' },
  oats: { symbol: 'ZO=F', label: 'Oats', unit: 'bu' },
  cotton: { symbol: 'CT=F', label: 'Cotton No. 2', unit: 'lb' },
};
const FILE = new URL('../prices.json', import.meta.url);

let previous = {};
try { previous = JSON.parse(await readFile(FILE, 'utf8')); } catch { /* first run */ }
const quotes = { ...(previous.quotes || {}) };
const failed = [];

for (const [key, m] of Object.entries(MARKETS)) {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(m.symbol)}?range=5d&interval=1d`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (school-farm-prices; github.com/getlitwithleo/School-Farm-Data)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const meta = (await res.json()).chart.result[0].meta;
    const cents = Number(meta.regularMarketPrice);
    if (!Number.isFinite(cents) || cents <= 0) throw new Error('no price in response');
    const name = meta.shortName || meta.longName || '';
    quotes[key] = {
      symbol: m.symbol,
      label: m.label,
      contract: name.includes(',') ? name.split(',').pop().trim() : '',
      unit: m.unit,
      price: Number((cents / 100).toFixed(4)), // quotes are in cents per bushel or per pound
      time: new Date(meta.regularMarketTime * 1000).toISOString(),
    };
  } catch (err) {
    failed.push(`${key}: ${err.message}`);
  }
}

if (failed.length === Object.keys(MARKETS).length) {
  console.error('No prices could be fetched:\n' + failed.join('\n'));
  process.exit(1);
}
if (failed.length) console.warn('Kept the previous price for:\n' + failed.join('\n'));

const changed = JSON.stringify(quotes) !== JSON.stringify(previous.quotes || {});
if (!changed) { console.log('Prices unchanged.'); process.exit(0); }

const asOf = Object.values(quotes).map(q => q.time).sort().pop();
const out = {
  asOf,
  source: 'Nearby CBOT and ICE futures, delayed, via Yahoo Finance',
  note: 'Futures prices in dollars per unit. The page adds each crop\'s basis to get the local sell price.',
  quotes,
};
await writeFile(FILE, JSON.stringify(out, null, 2) + '\n');
console.log('Updated prices.json:', Object.entries(quotes).map(([k, q]) => `${k} ${q.price}`).join(', '));
