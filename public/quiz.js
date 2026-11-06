// Gemeinsamer Code für Spieler- und Host-Seite: Verbindung, Uhrzeit und Ton.

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}

export const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* privater Modus */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* privater Modus */ } },
};

export const clock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function answerText(ends, now) {
  if (!ends) return '';
  const left = Math.ceil((ends - now) / 1000);
  return left > 0 ? `Noch ${left} Sekunden` : 'Zeit abgelaufen';
}

// WebSocket mit automatischem Wiederverbinden und Uhrenabgleich zum Server.
export class Link {
  constructor({ role = 'player', onOpen, onMessage, onStatus }) {
    Object.assign(this, { role, onOpen, onMessage, onStatus });
    this.offset = 0;
    this.bestRtt = Infinity;
    this.retry = 0;
    this.connect();
    setInterval(() => this.ping(), 20000);
  }
  connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${proto}//${location.host}/ws${this.role === 'host' ? '?role=host' : ''}`);
    this.ws.onopen = () => {
      this.retry = 0;
      this.bestRtt = Infinity;
      this.onStatus?.(true);
      for (let i = 0; i < 6; i += 1) setTimeout(() => this.ping(), i * 120);
      this.onOpen?.();
    };
    this.ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === 'pong') return this.pong(m);
      this.onMessage(m);
    };
    this.ws.onclose = () => {
      if (this.stopped) return;
      this.onStatus?.(false);
      this.retry += 1;
      setTimeout(() => this.connect(), Math.min(5000, 400 * this.retry));
    };
  }
  stop() { this.stopped = true; this.ws.close(); }
  send(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  ping() { this.send({ t: 'ping', c: Date.now() }); }
  pong({ c, s }) {
    const now = Date.now();
    const rtt = now - c;
    // Die Messung mit der kürzesten Laufzeit ist die genaueste.
    if (rtt <= this.bestRtt * 1.3) {
      this.bestRtt = Math.min(this.bestRtt, rtt);
      this.offset = s - (c + rtt / 2);
    }
  }
  serverNow() { return Date.now() + this.offset; }
}

// Spielt Intros über die Web-Audio-API, damit der Startzeitpunkt exakt planbar ist.
export class Engine {
  constructor({ link, headers = () => ({}), onLoaded, onError, onUnlock }) {
    Object.assign(this, { link, headers, onLoaded, onError, onUnlock });
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.buffers = new Map();
    this.loading = new Map();
    this.key = null;
    this.src = null;
    this.startedCtx = 0;
    this.offsetSec = 0;
    this.last = null;
    this.ctx.addEventListener('statechange', () => { this.refresh(); this.onUnlock?.(); });
  }
  get unlocked() { return this.ctx.state === 'running'; }
  async unlock() {
    try { await this.ctx.resume(); } catch { /* Browser verweigert */ }
    this.refresh();
    return this.unlocked;
  }
  volume(v) { this.master.gain.value = v; }
  has(id) { return this.buffers.has(id); }
  async load(id) {
    if (!id || this.buffers.has(id) || this.loading.has(id)) return;
    const job = (async () => {
      const r = await fetch(`/audio/${id}`, { headers: this.headers() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.arrayBuffer();
      const buffer = await this.ctx.decodeAudioData(data);
      this.buffers.set(id, buffer);
      for (const k of this.buffers.keys()) if (k !== id && k !== this.last?.round.audio) this.buffers.delete(k);
      this.onLoaded?.(id, buffer);
      this.refresh();
    })();
    this.loading.set(id, job);
    try { await job; } catch (e) { this.onError?.(id, e); } finally { this.loading.delete(id); }
  }
  stop() {
    if (this.src) {
      this.src.onended = null;
      try { this.src.stop(); } catch { /* lief nicht */ }
      this.src.disconnect();
      this.src = null;
    }
  }
  sync(state) {
    this.last = state;
    const id = state.round.audio;
    if (id && !this.has(id)) this.load(id);
    else if (state.round.preload) this.load(state.round.preload);
    const key = state.playing && id ? `${id}|${state.playing.from}|${state.playing.at}` : null;
    if (key !== this.key) { this.stop(); this.key = key; this.done = false; }
    if (!key || this.src || this.done || !this.unlocked) return;
    const buffer = this.buffers.get(id);
    if (!buffer) return;
    const inMs = state.playing.at - this.link.serverNow();
    const late = Math.max(0, -inMs) / 1000;
    const offset = state.playing.from / 1000 + late;
    if (offset >= buffer.duration) { this.done = true; return; }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.master);
    src.onended = () => { if (this.src === src) { this.src = null; this.done = true; } };
    src.start(this.ctx.currentTime + Math.max(0, inMs) / 1000, offset);
    this.src = src;
  }
  refresh() { if (this.last) this.sync(this.last); }
  tone(steps) {
    if (!this.unlocked) return;
    let t = this.ctx.currentTime;
    for (const [freq, dur, type = 'square'] of steps) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + dur);
      t += dur * 0.9;
    }
  }
  effect(kind) {
    if (kind === 'buzz') this.tone([[140, 0.32, 'sawtooth']]);
    if (kind === 'right') this.tone([[523, 0.1], [659, 0.1], [784, 0.2]]);
    if (kind === 'wrong') this.tone([[196, 0.16], [147, 0.3]]);
    if (kind === 'test') this.tone([[392, 0.12], [523, 0.12], [392, 0.24]]);
  }
}

export function scoreRows(players, { me = null, extra = null } = {}) {
  return players.map((p, i) => h('li', {
    class: `zeile${p.id === me ? ' ich' : ''}${p.online ? '' : ' weg'}${p.locked ? ' gesperrt' : ''}`,
  },
  h('span', { class: 'platz' }, `${i + 1}.`),
  h('span', { class: 'name' }, p.name,
    p.team ? h('span', { class: 'hinweis teamname' }, ` Team ${p.team}`) : null,
    p.online ? null : h('span', { class: 'hinweis' }, ' offline')),
  extra?.(p),
  h('span', { class: 'punkte' }, String(p.score))));
}
