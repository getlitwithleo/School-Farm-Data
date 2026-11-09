// School Farm shared records.
// Serves the site's files and a small API that keeps one shared copy of the farm records,
// so every device that opens the site sees the same data.
//
//   GET  /api/state[?known=N]  anyone: the current records and version (or {unchanged:true} if N is current)
//   PUT  /api/state            passcode: save records; body {baseVersion, data}; 409 with the newer copy if someone saved first
//   POST /api/unlock           passcode: check a passcode
//   POST /api/setup            anyone, once: set the first farm passcode; body {passcode}
//   POST /api/passcode         passcode: change the farm passcode; body {passcode}
//   GET  /api/history          passcode: the last 30 saved versions
//   GET  /api/backup?version=N passcode: download one saved version
//
// The farm passcode is set once from the site (Data & export → Sharing) and stored, salted and hashed,
// in this Worker's private storage; it is never in the repo. Passcodes ignore capital letters and spaces
// at the ends. A FARM_PASSCODE secret set in the Cloudflare dashboard (Workers & Pages →
// school-farm-data → Settings → Variables and Secrets) takes priority over the stored passcode.
// After 10 wrong passcodes, a connection has to wait 15 minutes.
import { DurableObject } from 'cloudflare:workers';

const KEEP_VERSIONS = 30;
const CHUNK = 256 * 1024; // characters per stored row, well under the 2 MB row limit
const MAX_BODY = 8 * 1024 * 1024;
const MAX_FAILS = 10, LOCK_MS = 15 * 60 * 1000;

export class FarmStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS versions (version INTEGER PRIMARY KEY, saved_at TEXT NOT NULL, size INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS chunks (version INTEGER NOT NULL, i INTEGER NOT NULL, part TEXT NOT NULL, PRIMARY KEY (version, i))');
    this.sql.exec('CREATE TABLE IF NOT EXISTS fails (ip TEXT PRIMARY KEY, n INTEGER NOT NULL, since INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
  }

  passInfo() {
    const rows = this.sql.exec("SELECT k, v FROM settings WHERE k IN ('pass_salt', 'pass_hash')").toArray();
    const get = k => (rows.find(r => r.k === k) || {}).v || null;
    return { salt: get('pass_salt'), hash: get('pass_hash') };
  }

  // onlyIfUnset makes first-time setup safe when two people try at once.
  setPass(salt, hash, onlyIfUnset) {
    if (onlyIfUnset && this.passInfo().hash) return false;
    this.sql.exec('INSERT OR REPLACE INTO settings (k, v) VALUES (?, ?)', 'pass_salt', salt);
    this.sql.exec('INSERT OR REPLACE INTO settings (k, v) VALUES (?, ?)', 'pass_hash', hash);
    return true;
  }

  locked(ip) {
    const row = this.sql.exec('SELECT n, since FROM fails WHERE ip = ?', ip).toArray()[0];
    return !!row && row.n >= MAX_FAILS && Date.now() - row.since < LOCK_MS;
  }

  failed(ip) {
    const now = Date.now();
    const row = this.sql.exec('SELECT n, since FROM fails WHERE ip = ?', ip).toArray()[0];
    if (!row || now - row.since >= LOCK_MS) this.sql.exec('INSERT OR REPLACE INTO fails (ip, n, since) VALUES (?, 1, ?)', ip, now);
    else this.sql.exec('UPDATE fails SET n = n + 1 WHERE ip = ?', ip);
    this.sql.exec('DELETE FROM fails WHERE since < ?', now - 24 * 60 * 60 * 1000);
  }

  passed(ip) {
    this.sql.exec('DELETE FROM fails WHERE ip = ?', ip);
  }

  current() {
    const row = this.sql.exec('SELECT version, saved_at FROM versions ORDER BY version DESC LIMIT 1').toArray()[0];
    return row ? { version: row.version, savedAt: row.saved_at } : { version: 0, savedAt: null };
  }

  read(version) {
    const parts = this.sql.exec('SELECT part FROM chunks WHERE version = ? ORDER BY i', version).toArray();
    return parts.length ? parts.map(p => p.part).join('') : null;
  }

  getState(known) {
    const cur = this.current();
    if (known != null && Number(known) === cur.version) return { ...cur, unchanged: true };
    return { ...cur, data: cur.version ? JSON.parse(this.read(cur.version)) : null };
  }

  putState(baseVersion, text) {
    const cur = this.current();
    if (baseVersion !== cur.version) {
      return { conflict: true, ...cur, data: cur.version ? JSON.parse(this.read(cur.version)) : null };
    }
    const version = cur.version + 1;
    const savedAt = new Date().toISOString();
    this.ctx.storage.transactionSync(() => {
      for (let i = 0, n = 0; i < text.length; i += CHUNK, n++) {
        this.sql.exec('INSERT INTO chunks (version, i, part) VALUES (?, ?, ?)', version, n, text.slice(i, i + CHUNK));
      }
      this.sql.exec('INSERT INTO versions (version, saved_at, size) VALUES (?, ?, ?)', version, savedAt, text.length);
      const old = this.sql.exec('SELECT version FROM versions ORDER BY version DESC LIMIT -1 OFFSET ?', KEEP_VERSIONS).toArray();
      for (const o of old) {
        this.sql.exec('DELETE FROM chunks WHERE version = ?', o.version);
        this.sql.exec('DELETE FROM versions WHERE version = ?', o.version);
      }
    });
    return { version, savedAt };
  }

  history() {
    return this.sql.exec('SELECT version, saved_at AS savedAt, size FROM versions ORDER BY version DESC').toArray();
  }

  backup(version) {
    return this.read(version);
  }
}

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

const norm = t => String(t || '').trim().toLowerCase();
const sha256 = async t => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)));
const toHex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
const fromHex = h => new Uint8Array((String(h || '').match(/[0-9a-f]{2}/gi) || []).map(x => parseInt(x, 16)));
const validNew = p => norm(p).length >= 4 && norm(p).length <= 64;
async function hashFor(passcode) {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  return { salt, hash: toHex(await sha256(salt + norm(passcode))) };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    const store = env.FARM.get(env.FARM.idFromName('school-farm'));
    const secret = typeof env.FARM_PASSCODE === 'string' && norm(env.FARM_PASSCODE).length >= 4 ? env.FARM_PASSCODE : null;
    const stored = secret ? null : await store.passInfo();
    const configured = !!secret || !!(stored && stored.hash);
    const ip = request.headers.get('cf-connecting-ip') || 'local';
    const passcodeMatches = async typed => {
      const given = secret ? await sha256(norm(typed)) : await sha256(stored.salt + norm(typed));
      const expected = secret ? await sha256(norm(secret)) : fromHex(stored.hash);
      return expected.length === given.length && crypto.subtle.timingSafeEqual(given, expected);
    };
    let lockedOut = false;
    const authed = async () => {
      if (!configured) return false;
      if (await store.locked(ip)) { lockedOut = true; return false; }
      const ok = await passcodeMatches(request.headers.get('x-farm-passcode') || '');
      if (ok) await store.passed(ip); else await store.failed(ip);
      return ok;
    };
    const denied = async () => {
      if (lockedOut) return json({ error: 'locked', message: 'Too many wrong passcodes. Try again in 15 minutes.' }, 429);
      await sleep(500); return json({ error: 'bad-passcode' }, 401);
    };
    const { pathname } = url, method = request.method;

    if (pathname === '/api/state' && method === 'GET') {
      return json({ ...(await store.getState(url.searchParams.get('known'))), configured });
    }
    if (pathname === '/api/state' && method === 'PUT') {
      if (!configured) return json({ error: 'not-configured' }, 503);
      if (!(await authed())) return denied();
      if (Number(request.headers.get('content-length') || 0) > MAX_BODY) return json({ error: 'too-large' }, 413);
      let body;
      try { body = await request.json(); } catch { return json({ error: 'bad-json' }, 400); }
      if (!body || !Number.isInteger(body.baseVersion) || !body.data || !Array.isArray(body.data.fields)) return json({ error: 'bad-request' }, 400);
      const result = await store.putState(body.baseVersion, JSON.stringify(body.data));
      return json({ ...result, configured }, result.conflict ? 409 : 200);
    }
    if (pathname === '/api/unlock' && method === 'POST') {
      if (!configured) return json({ error: 'not-configured' }, 503);
      return (await authed()) ? json({ ok: true }) : denied();
    }
    if (pathname === '/api/setup' && method === 'POST') {
      if (configured) return json({ error: 'already-set' }, 409);
      let body; try { body = await request.json(); } catch { return json({ error: 'bad-json' }, 400); }
      if (!body || !validNew(body.passcode)) return json({ error: 'bad-passcode-format', message: 'Use 4 to 64 characters.' }, 400);
      const { salt, hash } = await hashFor(body.passcode);
      return (await store.setPass(salt, hash, true)) ? json({ ok: true }) : json({ error: 'already-set' }, 409);
    }
    if (pathname === '/api/passcode' && method === 'POST') {
      if (secret) return json({ error: 'managed-in-cloudflare' }, 409);
      if (!(await authed())) return denied();
      let body; try { body = await request.json(); } catch { return json({ error: 'bad-json' }, 400); }
      if (!body || !validNew(body.passcode)) return json({ error: 'bad-passcode-format', message: 'Use 4 to 64 characters.' }, 400);
      const { salt, hash } = await hashFor(body.passcode);
      await store.setPass(salt, hash, false);
      return json({ ok: true });
    }
    if (pathname === '/api/history' && method === 'GET') {
      if (!(await authed())) return denied();
      return json({ versions: await store.history() });
    }
    if (pathname === '/api/backup' && method === 'GET') {
      if (!(await authed())) return denied();
      const version = Number(url.searchParams.get('version'));
      const text = Number.isInteger(version) ? await store.backup(version) : null;
      if (!text) return json({ error: 'not-found' }, 404);
      return new Response(text, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
        'content-disposition': `attachment; filename="school-farm-shared-v${version}.json"` } });
    }
    return json({ error: 'not-found' }, 404);
  },
};
