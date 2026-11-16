// Refreshes the market price files the page reads:
//   prices.json         the latest nearby futures price for each crop (sell price = futures + basis)
//   price-history.json  a year of daily closes, so a sale's "market at the time" can be filled in
// Run by .github/workflows/update-prices.yml each weekday after the grain markets close.
import { readFile, writeFile } from 'node:fs/promises';

const MARKETS = {
  corn: { symbol: 'ZC=F', label: 'Corn', unit: 'bu' },
  soybeans: { symbol: 'ZS=F', label: 'Soybeans', unit: 'bu' },
  wheat: { symbol: 'ZW=F', label: 'Chicago SRW wheat', unit: 'bu' },
  oats: { symbol: 'ZO=F', label: 'Oats', unit: 'bu' },
  cotton: { symbol: 'CT=F', label: 'Cotton No. 2', unit: 'lb' },
};
const PRICES = new URL('../prices.json', import.meta.url);
const HISTORY = new URL('../price-history.json', import.meta.url);
const KEEP_DAYS = 400;

const readJson = async file => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return {}; } };
const previous = await readJson(PRICES);
const previousHistory = await readJson(HISTORY);
const quotes = { ...(previous.quotes || {}) };
const days = { ...(previousHistory.days || {}) };
const failed = [];

for (const [key, m] of Object.entries(MARKETS)) {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(m.symbol)}?range=1y&interval=1d`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (school-farm-prices; github.com/getlitwithleo/School-Farm-Data)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const result = (await res.json()).chart.result[0];
    const meta = result.meta;
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
    // Date each bar in the exchange's own time zone, so daylight saving time and short holiday
    // sessions land on the right trading day.
    const dayOf = new Intl.DateTimeFormat('en-CA', { timeZone: meta.exchangeTimezoneName || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
    const closes = (result.indicators && result.indicators.quote && result.indicators.quote[0] && result.indicators.quote[0].close) || [];
    (result.timestamp || []).forEach((ts, i) => {
      const c = Number(closes[i]);
      if (!Number.isFinite(c) || c <= 0) return;
      const date = dayOf.format(new Date(ts * 1000));
      days[date] = { ...(days[date] || {}), [key]: Number((c / 100).toFixed(4)) };
    });
  } catch (err) {
    failed.push(`${key}: ${err.message}`);
  }
}

if (failed.length === Object.keys(MARKETS).length) {
  console.error('No prices could be fetched:\n' + failed.join('\n'));
  process.exit(1);
}
if (failed.length) console.warn('Kept the previous price for:\n' + failed.join('\n'));

if (JSON.stringify(quotes) !== JSON.stringify(previous.quotes || {})) {
  await writeFile(PRICES, JSON.stringify({
    asOf: Object.values(quotes).map(q => q.time).sort().pop(),
    source: 'Nearby CBOT and ICE futures, delayed, via Yahoo Finance',
    note: 'Futures prices in dollars per unit. The page adds each crop\'s basis to get the local sell price.',
    quotes,
  }, null, 2) + '\n');
  console.log('Updated prices.json:', Object.entries(quotes).map(([k, q]) => `${k} ${q.price}`).join(', '));
} else console.log('prices.json unchanged.');

const kept = Object.keys(days).sort().slice(-KEEP_DAYS);
const trimmed = Object.fromEntries(kept.map(d => [d, days[d]]));
if (JSON.stringify(trimmed) !== JSON.stringify(previousHistory.days || {})) {
  // One line per day keeps the daily git changes small and readable.
  const body = kept.map(d => `    ${JSON.stringify(d)}: ${JSON.stringify(trimmed[d])}`).join(',\n');
  await writeFile(HISTORY, `{\n  "source": "Daily closes of nearby CBOT and ICE futures, dollars per unit, via Yahoo Finance",\n  "days": {\n${body}\n  }\n}\n`);
  console.log(`Updated price-history.json: ${kept.length} trading days, ${kept[0]} to ${kept[kept.length - 1]}`);
} else console.log('price-history.json unchanged.');
