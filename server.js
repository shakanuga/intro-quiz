'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');
const { WebSocketServer, WebSocket } = require('ws');
const { Game, id } = require('./lib/game');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || '/data';
const HOST_PASSWORD = process.env.HOST_PASSWORD || '';
const MAX_UPLOAD = 40 * 1024 * 1024;
const PUBLIC_DIR = path.join(__dirname, 'public');
const INTRO_DIR = path.join(DATA_DIR, 'intros');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const SESSION_HOURS = 24;

if (HOST_PASSWORD.length < 8) {
  console.error('HOST_PASSWORD fehlt oder ist kürzer als 8 Zeichen. Setze die Variable im Container.');
  process.exit(1);
}

fs.mkdirSync(INTRO_DIR, { recursive: true });

// ---------- Speichern ----------
let saved = null;
try { saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) {
  if (e.code !== 'ENOENT') console.error('state.json ist nicht lesbar, starte leer:', e.message);
}
let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const tmp = `${STATE_FILE}.tmp`;
    fs.writeFile(tmp, JSON.stringify(game), (err) => {
      if (err) return console.error('Speichern fehlgeschlagen:', err.message);
      fs.rename(tmp, STATE_FILE, (e) => { if (e) console.error('Speichern fehlgeschlagen:', e.message); });
    });
  }, 300);
}
let broadcastQueued = false;
function changed() {
  save();
  if (broadcastQueued) return;
  broadcastQueued = true;
  setImmediate(() => { broadcastQueued = false; broadcast(); });
}
const game = new Game({ saved, onChange: changed });

// ---------- Host-Anmeldung ----------
// Das Cookie ist signiert und überlebt so auch einen Neustart des Containers.
const sessionKey = crypto.createHmac('sha256', HOST_PASSWORD).update('intro-quiz-session').digest();
const signSession = (exp) => crypto.createHmac('sha256', sessionKey).update(String(exp)).digest('hex');
const failedLogins = new Map();
const sha = (s) => crypto.createHash('sha256').update(s).digest();
const clientIp = (req) => req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '?';
function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((c) => {
    const i = c.indexOf('=');
    return i < 0 ? [c.trim(), ''] : [c.slice(0, i).trim(), c.slice(i + 1).trim()];
  }));
}
function isHost(req) {
  const [exp, sig] = (cookies(req).quiz_host || '').split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(signSession(exp));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function loginBlocked(ip) {
  const f = failedLogins.get(ip);
  if (!f) return false;
  if (f.until < Date.now()) { failedLogins.delete(ip); return false; }
  return f.count >= 8;
}
function noteFailure(ip) {
  const f = failedLogins.get(ip) ?? { count: 0, until: Date.now() + 10 * 60 * 1000 };
  f.count += 1;
  failedLogins.set(ip, f);
}

// ---------- HTTP ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.ttf': 'font/ttf', '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.opus': 'audio/ogg',
  '.wav': 'audio/wav', '.flac': 'audio/flac',
};
const AUDIO_EXT = new Set(['.mp3', '.m4a', '.ogg', '.opus', '.wav', '.flac']);
const PAGES = { '/': 'index.html', '/host': 'host.html' };

function securityHeaders(req, res) {
  const host = String(req.headers.host || '').replace(/[^a-zA-Z0-9.:\-\[\]]/g, '');
  res.setHeader('Content-Security-Policy',
    `default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; ` +
    `connect-src 'self' wss://${host} ws://${host}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}
function send(res, status, body, type = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(data);
}
function readJson(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}
function serveStatic(req, res, file) {
  const full = path.join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, { error: 'Nicht gefunden' });
  fs.readFile(full, (err, data) => {
    if (err) return send(res, 404, { error: 'Nicht gefunden' });
    const cache = file.startsWith('fonts/') ? 'public, max-age=604800' : 'no-cache';
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cache });
    res.end(data);
  });
}
function looksLikeAudio(b) {
  const s4 = b.subarray(0, 4).toString('latin1');
  return s4 === 'ID3\u0003' || s4 === 'ID3\u0004' || s4 === 'ID3\u0002' || s4 === 'OggS' || s4 === 'RIFF' || s4 === 'fLaC'
    || b.subarray(4, 8).toString('latin1') === 'ftyp'
    || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0);
}
function titleFromFile(name) {
  return path.basename(name, path.extname(name)).replace(/[_]+/g, ' ').replace(/^\s*\d+\s*[-.)]\s*/, '').trim() || 'Ohne Titel';
}

async function upload(req, res, url) {
  const name = path.basename(url.searchParams.get('name') || '');
  const ext = path.extname(name).toLowerCase();
  if (!AUDIO_EXT.has(ext)) return send(res, 415, { error: `${name}: Erlaubt sind MP3, M4A, OGG, OPUS, WAV und FLAC.` });
  if (Number(req.headers['content-length'] || 0) > MAX_UPLOAD) {
    req.resume();
    return send(res, 413, { error: `${name}: Die Datei ist größer als 40 MB.` });
  }
  const rid = id();
  const tmp = path.join(INTRO_DIR, `.upload-${rid}`);
  const final = path.join(INTRO_DIR, rid + ext);
  let size = 0;
  let head = Buffer.alloc(0);
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length;
      if (head.length < 12) head = Buffer.concat([head, chunk]).subarray(0, 12);
      cb(size > MAX_UPLOAD ? new Error('too large') : null, chunk);
    },
  });
  try {
    await pipeline(req, counter, fs.createWriteStream(tmp));
    if (!looksLikeAudio(head)) throw new Error('not audio');
    await fs.promises.rename(tmp, final);
  } catch (e) {
    await fs.promises.unlink(tmp).catch(() => {});
    if (e.message === 'too large') return send(res, 413, { error: `${name}: Die Datei ist größer als 40 MB.` });
    if (e.message === 'not audio') return send(res, 415, { error: `${name}: Das ist keine Audiodatei.` });
    return send(res, 500, { error: `${name}: Das Hochladen ist fehlgeschlagen.` });
  }
  game.addIntro({ id: rid, ext, title: titleFromFile(name), size });
  send(res, 200, { id: rid });
}

function serveAudio(req, res, rid, url) {
  const token = req.headers['x-player-token'] || url.searchParams.get('k') || '';
  const host = isHost(req);
  const entry = game.library.find((r) => r.id === rid);
  if (!entry || !/^[a-f0-9]+$/.test(rid)) return send(res, 404, { error: 'Nicht gefunden' });
  // Spieler bekommen nur das Intro der laufenden Runde.
  if (!host && !(game.validToken(token) && game.currentId === rid)) return send(res, 403, { error: 'Kein Zugriff' });
  const file = path.join(INTRO_DIR, rid + entry.ext);
  fs.stat(file, (err, st) => {
    if (err) return send(res, 404, { error: 'Die Datei fehlt.' });
    res.writeHead(200, {
      'Content-Type': MIME[entry.ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'private, no-store',
    });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  securityHeaders(req, res);
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (p === '/health') return send(res, 200, { ok: true });
      if (p === '/api/host/me') return send(res, isHost(req) ? 200 : 401, { ok: isHost(req) });
      if (PAGES[p]) return serveStatic(req, res, PAGES[p]);
      if (p.startsWith('/audio/')) return serveAudio(req, res, p.slice(7), url);
      if (/^\/[a-z-]+\.(css|js)$/.test(p) || /^\/fonts\/[\w.-]+$/.test(p)) return serveStatic(req, res, p.slice(1));
      return send(res, 404, { error: 'Nicht gefunden' });
    }
    if (req.method === 'POST' && p === '/api/host/login') {
      const ip = clientIp(req);
      if (loginBlocked(ip)) return send(res, 429, { error: 'Zu viele Versuche. Warte 10 Minuten.' });
      const { password } = await readJson(req);
      if (typeof password !== 'string' || !crypto.timingSafeEqual(sha(password), sha(HOST_PASSWORD))) {
        noteFailure(ip);
        return send(res, 401, { error: 'Das Passwort stimmt nicht.' });
      }
      failedLogins.delete(ip);
      const exp = Date.now() + SESSION_HOURS * 3600 * 1000;
      const t = `${exp}.${signSession(exp)}`;
      const secure = req.headers['x-forwarded-proto'] === 'https' || req.headers['cf-visitor'];
      res.setHeader('Set-Cookie',
        `quiz_host=${t}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}${secure ? '; Secure' : ''}`);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/host/intros') {
      if (!isHost(req)) { req.resume(); return send(res, 401, { error: 'Bitte melde dich an.' }); }
      return await upload(req, res, url);
    }
    send(res, 404, { error: 'Nicht gefunden' });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 400, { error: 'Die Anfrage ist ungültig.' });
  }
});

// ---------- WebSocket ----------
const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });
const clients = new Set();

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  let originHost = null;
  try { originHost = new URL(req.headers.origin).host; } catch { /* kein Origin */ }
  if (url.pathname !== '/ws' || originHost !== req.headers.host) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

function sendTo(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
function viewFor(ws) {
  if (ws.isHost) return game.hostView();
  const v = game.view();
  v.me = ws.pid;
  v.locked = game.locked.has(ws.pid);
  return v;
}
function broadcast() {
  for (const ws of clients) {
    if (ws.isHost || ws.pid) sendTo(ws, { t: 'state', state: viewFor(ws) });
  }
}

const HOST_COMMANDS = {
  start: () => game.start(),
  play: () => game.play(),
  pause: () => game.pause(),
  resume: () => game.resume(),
  correct: () => game.correct(),
  wrong: () => game.wrong(),
  reveal: () => game.reveal(),
  playOn: () => game.playOn(),
  next: () => game.next(),
  restartRound: () => game.restartRound(),
  goTo: (m) => game.goTo(m.id),
  finish: () => game.finish(),
  newGame: () => {
    for (const c of clients) if (!c.isHost) { sendTo(c, { t: 'kicked', reason: 'Das Spiel wurde neu gestartet. Tritt mit dem neuen Code bei.' }); c.close(); }
    return game.newGame();
  },
  adjust: (m) => game.adjust(m.id, m.delta),
  kick: (m) => {
    for (const c of clients) if (c.pid === m.id) { sendTo(c, { t: 'kicked', reason: 'Du wurdest aus dem Spiel entfernt.' }); c.close(); }
    return game.kick(m.id);
  },
  settings: (m) => game.setSettings(m),
  rename: (m) => game.rename(m.id, m.title),
  move: (m) => game.move(m.id, m.dir),
  shuffle: () => game.shuffle(),
  include: (m) => game.include(m.id),
  exclude: (m) => game.exclude(m.id),
  clearQuiz: () => game.clearQuiz(),
  saveQuiz: (m) => game.saveQuiz(m.name),
  loadQuiz: (m) => game.loadQuiz(m.id),
  deleteQuiz: (m) => game.deleteQuiz(m.id),
  rematch: () => game.rematch(),
  stats: (_m, ws) => sendTo(ws, { t: 'stats', stats: game.stats() }),
  deleteGame: (m, ws) => {
    game.deleteGame(m.id);
    sendTo(ws, { t: 'stats', stats: game.stats() });
  },
  duration: (m) => game.setDuration(m.id, m.ms),
  remove: (m) => {
    const gone = game.remove(m.id);
    if (gone) fs.unlink(path.join(INTRO_DIR, gone.id + gone.ext), () => {});
    return !!gone;
  },
};

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.pid = null;
  ws.badCodes = 0;
  const wantsHost = new URL(req.url, 'http://x').searchParams.get('role') === 'host';
  ws.isHost = wantsHost && isHost(req);
  clients.add(ws);
  if (wantsHost && !ws.isHost) { sendTo(ws, { t: 'needLogin' }); return ws.close(); }
  ws.on('pong', () => { ws.isAlive = true; });
  if (ws.isHost) sendTo(ws, { t: 'state', state: viewFor(ws) });

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m?.t === 'ping') return sendTo(ws, { t: 'pong', c: m.c, s: Date.now() });
    if (m?.t === 'hello' && !ws.isHost && !ws.pid) {
      const r = game.join({ code: m.code, name: m.name, token: m.token });
      if (!r.ok) {
        sendTo(ws, { t: 'error', error: r.error, forget: !!m.token });
        if (r.badCode && ++ws.badCodes >= 10) ws.close();
        return;
      }
      for (const c of clients) if (c !== ws && c.pid === r.id) c.close(); // alter Tab derselben Person
      ws.pid = r.id;
      game.setOnline(r.id, true);
      sendTo(ws, { t: 'joined', id: r.id, token: r.token });
      return sendTo(ws, { t: 'state', state: viewFor(ws) });
    }
    if (ws.pid && m?.t === 'buzz') return game.buzz(ws.pid);
    if (ws.pid && m?.t === 'loaded') return game.setLoaded(ws.pid, m.id);
    if (ws.isHost && m?.t === 'cmd' && Object.hasOwn(HOST_COMMANDS, m.a)) HOST_COMMANDS[m.a](m, ws);
  });
  ws.on('close', () => {
    clients.delete(ws);
    if (ws.pid && ![...clients].some((c) => c.pid === ws.pid)) game.setOnline(ws.pid, false);
  });
  ws.on('error', () => {});
});

// Hält die Verbindung durch den Tunnel offen und räumt tote Verbindungen auf.
setInterval(() => {
  for (const ws of clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 25000).unref();

server.listen(PORT, '0.0.0.0', () => console.log(`Intro-Quiz läuft auf Port ${PORT}`));

function shutdown() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(game)); } catch (e) { console.error(e.message); }
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
