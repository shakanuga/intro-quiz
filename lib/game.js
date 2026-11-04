'use strict';
// Spiellogik ohne Netzwerk, damit sie sich direkt testen lässt.
// Die Uhr des Servers entscheidet über alles: Wer zuerst ankommt, hat gebuzzert.
const crypto = require('crypto');

const START_LEAD_MS = 900;   // Vorlauf, damit der Ton bei allen gleichzeitig startet
const RESUME_LEAD_MS = 1500; // Kurze Pause, bevor das Intro nach "Falsch" weiterläuft
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MAX_PLAYERS = 40;
const MAX_HISTORY = 500;
const MAX_QUIZZES = 200;

const id = (bytes = 12) => crypto.randomBytes(bytes).toString('hex');
const newCode = () => Array.from({ length: 4 }, () => CODE_LETTERS[crypto.randomInt(CODE_LETTERS.length)]).join('');
const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();

class Game {
  constructor({ now = Date.now, saved = null, onChange = () => {} } = {}) {
    this.now = now;
    this.onChange = onChange;
    this.library = saved?.library ?? []; // alle hochgeladenen Intros
    const known = new Set(this.library.map((r) => r.id));
    // Das aktuelle Quiz: Ältere Spielstände hatten nur die Intro-Liste.
    this.playlist = (saved?.playlist ?? [...known]).filter((rid) => known.has(rid));
    this.quizzes = saved?.quizzes ?? [];
    this.quizName = saved?.quizName ?? null;
    this.history = saved?.history ?? [];
    this.gameId = saved?.gameId ?? id(6);
    this.startedAt = saved?.startedAt ?? null;
    this.rounds = saved?.rounds ?? [];
    this.settings = { right: 3, wrong: -1, multiBuzz: false, answerSeconds: 0, ...(saved?.settings ?? {}) };
    this.tokens = new Map(); // Spieler-Token → Spieler-ID, wird nicht an andere geschickt
    this.players = new Map();
    for (const p of saved?.players ?? []) {
      this.players.set(p.id, { id: p.id, name: p.name, score: p.score, online: false, loaded: null });
      this.tokens.set(p.token, p.id);
    }
    this.code = saved?.code ?? newCode();
    this.phase = saved?.phase ?? 'lobby';
    this.currentId = saved?.currentId ?? null;
    this.locked = new Set(saved?.locked ?? []);
    this.buzzerId = saved?.buzzerId ?? null;
    this.winnerId = saved?.winnerId ?? null;
    this.pos = saved?.pos ?? 0;
    this.answerEnds = null;
    this.playing = null;
    this.outro = false;
    this.fx = { n: 0, kind: null };
    // Nach einem Neustart läuft kein Ton mehr: Die Runde wartet auf den Host.
    if (this.phase === 'playing') this.phase = 'paused';
    if (!this.current() && !['lobby', 'finished'].includes(this.phase)) this.phase = 'lobby';
  }

  // ---------- Hilfen ----------
  current() { return this.library.find((r) => r.id === this.currentId) ?? null; }
  index() { return this.playlist.indexOf(this.currentId); }
  active() { return [...this.players.values()].filter((p) => p.online); }
  position() {
    if (!this.playing) return this.pos;
    return Math.max(this.playing.from, this.playing.from + this.now() - this.playing.at);
  }
  changed() { this.onChange(); return true; }
  effect(kind) { this.fx = { n: this.fx.n + 1, kind }; }
  startAudio(lead) {
    this.playing = { from: this.pos, at: this.now() + lead };
  }
  stopAudio() {
    if (this.playing) this.pos = this.position();
    this.playing = null;
  }
  enterRound(rid) {
    this.stopAudio();
    this.currentId = rid;
    this.startedAt ??= this.now();
    this.rounds = this.rounds.filter((r) => r.id !== rid);
    this.rounds.push({ id: rid, title: this.current().title, winner: null, wrong: [], ms: null, done: false });
    this.phase = 'ready';
    this.pos = 0;
    this.outro = false;
    this.buzzerId = null;
    this.answerEnds = null;
    this.winnerId = null;
    this.locked.clear();
    for (const p of this.players.values()) p.loaded = null;
  }

  record() { return this.rounds.find((r) => r.id === this.currentId) ?? null; }
  closeRound(fields = {}) {
    const rec = this.record();
    if (rec) Object.assign(rec, fields, { done: true });
  }
  // Legt das Spiel in der Statistik ab. Läuft es danach weiter, wird der Eintrag ersetzt.
  archive() {
    const rounds = this.rounds.filter((r) => r.done);
    if (!rounds.length || !this.players.size) return;
    const entry = {
      id: this.gameId,
      at: this.startedAt ?? this.now(),
      quiz: this.quizName,
      total: this.playlist.length,
      players: this.publicPlayers().map(({ name, score }) => ({ name, score })),
      rounds: rounds.map(({ title, winner, wrong, ms }) => ({ title, winner, wrong, ms })),
    };
    const i = this.history.findIndex((g) => g.id === this.gameId);
    if (i >= 0) this.history[i] = entry;
    else this.history.unshift(entry);
    this.history.length = Math.min(this.history.length, MAX_HISTORY);
  }
  resetRun() {
    this.stopAudio();
    this.phase = 'lobby';
    this.currentId = null;
    this.locked.clear();
    this.buzzerId = null;
    this.answerEnds = null;
    this.winnerId = null;
    this.pos = 0;
    this.outro = false;
    this.gameId = id(6);
    this.startedAt = null;
    this.rounds = [];
  }

  // ---------- Spieler ----------
  join({ code, name, token }) {
    const known = token ? this.tokens.get(token) : null;
    if (known && this.players.has(known)) {
      return { ok: true, id: known, token };
    }
    if (String(code ?? '').trim().toUpperCase() !== this.code) {
      return { ok: false, error: 'Der Spielcode stimmt nicht.', badCode: true };
    }
    const clean = cleanName(name).slice(0, 20);
    if (clean.length < 2) return { ok: false, error: 'Gib einen Namen mit mindestens 2 Zeichen ein.' };
    const taken = [...this.players.values()].some((p) => p.name.toLowerCase() === clean.toLowerCase());
    if (taken) return { ok: false, error: 'Dieser Name ist schon vergeben.' };
    if (this.players.size >= MAX_PLAYERS) return { ok: false, error: 'Das Spiel ist voll.' };
    const pid = id(6);
    const tok = id(18);
    this.players.set(pid, { id: pid, name: clean, score: 0, online: false, loaded: null });
    this.tokens.set(tok, pid);
    this.changed();
    return { ok: true, id: pid, token: tok };
  }
  validToken(token) { return this.tokens.has(token); }
  setOnline(pid, online) {
    const p = this.players.get(pid);
    if (!p) return;
    p.online = online;
    this.changed();
  }
  setLoaded(pid, roundId) {
    const p = this.players.get(pid);
    if (!p || roundId !== this.currentId) return;
    p.loaded = roundId;
    this.changed();
  }
  buzz(pid) {
    if (this.phase !== 'playing' || !this.playing) return false;
    if (!this.players.has(pid) || this.locked.has(pid)) return false;
    if (this.now() < this.playing.at) return false; // Ton läuft noch nicht
    this.stopAudio();
    this.buzzerId = pid;
    // Der Countdown ist nur eine Anzeige: Gewertet wird immer vom Host.
    const secs = this.settings.answerSeconds;
    this.answerEnds = secs > 0 ? this.now() + secs * 1000 : null;
    this.phase = 'judging';
    this.effect('buzz');
    return this.changed();
  }

  // ---------- Host ----------
  start() {
    if (this.phase !== 'lobby' || !this.playlist.length) return false;
    this.enterRound(this.playlist[0]);
    return this.changed();
  }
  play() {
    if (this.phase !== 'ready') return false;
    this.phase = 'playing';
    this.startAudio(START_LEAD_MS);
    return this.changed();
  }
  pause() {
    if (this.phase !== 'playing') return false;
    this.stopAudio();
    this.phase = 'paused';
    return this.changed();
  }
  resume() {
    if (this.phase !== 'paused') return false;
    this.phase = 'playing';
    this.startAudio(START_LEAD_MS);
    return this.changed();
  }
  correct() {
    if (this.phase !== 'judging') return false;
    const p = this.players.get(this.buzzerId);
    if (p) p.score += this.settings.right;
    this.closeRound({ winner: p?.name ?? null, ms: Math.round(this.pos) });
    this.winnerId = this.buzzerId;
    this.buzzerId = null;
    this.answerEnds = null;
    this.phase = 'reveal';
    this.effect('right');
    return this.changed();
  }
  wrong() {
    if (this.phase !== 'judging') return false;
    const p = this.players.get(this.buzzerId);
    if (p) p.score += this.settings.wrong;
    if (p) this.record()?.wrong.push(p.name);
    if (!this.settings.multiBuzz) this.locked.add(this.buzzerId);
    this.buzzerId = null;
    this.answerEnds = null;
    this.effect('wrong');
    const anyoneLeft = this.active().some((x) => !this.locked.has(x.id));
    if (anyoneLeft) {
      this.phase = 'playing';
      this.startAudio(RESUME_LEAD_MS);
    } else {
      this.closeRound();
      this.phase = 'reveal';
    }
    return this.changed();
  }
  reveal() {
    if (!['playing', 'paused', 'ready'].includes(this.phase)) return false;
    this.stopAudio();
    this.closeRound();
    this.winnerId = null;
    this.phase = 'reveal';
    return this.changed();
  }
  playOn() {
    if (this.phase !== 'reveal' || this.outro) return false;
    this.outro = true;
    this.startAudio(START_LEAD_MS);
    return this.changed();
  }
  next() {
    if (this.phase !== 'reveal') return false;
    const nextRound = this.playlist[this.index() + 1];
    if (nextRound) {
      this.enterRound(nextRound);
    } else {
      this.stopAudio();
      this.phase = 'finished';
      this.archive();
    }
    return this.changed();
  }
  restartRound() {
    if (!this.current() || this.phase === 'lobby') return false;
    this.enterRound(this.currentId);
    return this.changed();
  }
  goTo(rid) {
    if (this.phase === 'lobby' || !this.playlist.includes(rid)) return false;
    this.enterRound(rid);
    return this.changed();
  }
  finish() {
    if (this.phase === 'lobby') return false;
    this.stopAudio();
    this.phase = 'finished';
    this.archive();
    return this.changed();
  }
  newGame() {
    this.archive();
    this.resetRun();
    this.players.clear();
    this.tokens.clear();
    this.code = newCode();
    return this.changed();
  }
  // Neues Spiel mit denselben Leuten: Alle bleiben drin, die Punkte starten bei null.
  rematch() {
    if (this.phase === 'lobby') return false;
    this.archive();
    this.resetRun();
    for (const p of this.players.values()) { p.score = 0; p.loaded = null; }
    return this.changed();
  }
  adjust(pid, delta) {
    const p = this.players.get(pid);
    const d = Math.trunc(Number(delta));
    if (!p || !Number.isFinite(d) || Math.abs(d) > 100) return false;
    p.score += d;
    return this.changed();
  }
  kick(pid) {
    if (!this.players.has(pid)) return false;
    this.players.delete(pid);
    for (const [tok, owner] of this.tokens) if (owner === pid) this.tokens.delete(tok);
    this.locked.delete(pid);
    if (this.buzzerId === pid) {
      this.buzzerId = null;
      this.answerEnds = null;
      this.phase = 'playing';
      this.startAudio(RESUME_LEAD_MS);
    }
    return this.changed();
  }
  setSettings({ right, wrong, multiBuzz, answerSeconds }) {
    const r = Math.trunc(Number(right));
    const w = Math.trunc(Number(wrong));
    const a = Math.trunc(Number(answerSeconds));
    if (![r, w, a].every(Number.isFinite) || r < 0 || r > 100 || w > 0 || w < -100 || a < 0 || a > 120) return false;
    const multi = multiBuzz === true;
    this.settings = { right: r, wrong: w, multiBuzz: multi, answerSeconds: a };
    if (multi) this.locked.clear(); // Wer schon gesperrt war, darf dann wieder buzzern.
    return this.changed();
  }

  // ---------- Intros und Quizze ----------
  addIntro(entry) {
    this.library.push(entry);
    this.playlist.push(entry.id);
    this.quizName = null;
    return this.changed();
  }
  rename(rid, title) {
    const r = this.library.find((x) => x.id === rid);
    const clean = cleanName(title).slice(0, 80);
    if (!r || !clean) return false;
    r.title = clean;
    return this.changed();
  }
  move(rid, dir) {
    const i = this.playlist.indexOf(rid);
    const j = i + (dir < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= this.playlist.length) return false;
    [this.playlist[i], this.playlist[j]] = [this.playlist[j], this.playlist[i]];
    return this.changed();
  }
  shuffle() {
    for (let i = this.playlist.length - 1; i > 0; i -= 1) {
      const j = crypto.randomInt(i + 1);
      [this.playlist[i], this.playlist[j]] = [this.playlist[j], this.playlist[i]];
    }
    return this.changed();
  }
  include(rid) {
    if (this.playlist.includes(rid) || !this.library.some((r) => r.id === rid)) return false;
    this.playlist.push(rid);
    return this.changed();
  }
  exclude(rid) {
    if (rid === this.currentId || !this.playlist.includes(rid)) return false;
    this.playlist = this.playlist.filter((x) => x !== rid);
    return this.changed();
  }
  clearQuiz() {
    if (this.phase !== 'lobby') return false;
    this.playlist = [];
    this.quizName = null;
    return this.changed();
  }
  saveQuiz(name) {
    const clean = cleanName(name).slice(0, 60);
    if (!clean || !this.playlist.length) return false;
    const same = this.quizzes.find((q) => q.name.toLowerCase() === clean.toLowerCase());
    if (same) {
      same.name = clean;
      same.ids = [...this.playlist];
    } else {
      if (this.quizzes.length >= MAX_QUIZZES) return false;
      this.quizzes.push({ id: id(6), name: clean, ids: [...this.playlist] });
    }
    this.quizName = clean;
    return this.changed();
  }
  loadQuiz(qid) {
    const q = this.quizzes.find((x) => x.id === qid);
    if (!q || this.phase !== 'lobby') return false;
    this.playlist = [...q.ids];
    this.quizName = q.name;
    return this.changed();
  }
  deleteQuiz(qid) {
    const before = this.quizzes.length;
    this.quizzes = this.quizzes.filter((q) => q.id !== qid);
    return before !== this.quizzes.length && this.changed();
  }
  remove(rid) {
    if (rid === this.currentId && this.phase !== 'finished') return null;
    const i = this.library.findIndex((r) => r.id === rid);
    if (i < 0) return null;
    const [gone] = this.library.splice(i, 1);
    this.playlist = this.playlist.filter((x) => x !== rid);
    for (const q of this.quizzes) q.ids = q.ids.filter((x) => x !== rid);
    this.changed();
    return gone;
  }
  setDuration(rid, ms) {
    const r = this.library.find((x) => x.id === rid);
    const d = Math.round(Number(ms));
    if (!r || !Number.isFinite(d) || d <= 0 || r.duration === d) return false;
    r.duration = d;
    return this.changed();
  }

  // ---------- Was die Clients sehen ----------
  publicPlayers() {
    return [...this.players.values()]
      .map((p) => ({
        id: p.id, name: p.name, score: p.score, online: p.online,
        loaded: p.loaded !== null && p.loaded === this.currentId,
        locked: this.locked.has(p.id),
      }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'de'));
  }
  view() {
    const cur = this.current();
    const showTitle = this.phase === 'reveal';
    const name = (pid) => this.players.get(pid)?.name ?? null;
    return {
      phase: this.phase,
      round: cur ? {
        n: this.index() + 1,
        total: this.playlist.length,
        audio: this.phase === 'finished' ? null : cur.id,
        duration: cur.duration ?? null,
        title: showTitle ? cur.title : null,
      } : { n: 0, total: this.playlist.length, audio: null, duration: null, title: null },
      playing: this.playing,
      answerEnds: this.answerEnds,
      pos: this.pos,
      outro: this.outro,
      buzzer: this.buzzerId ? { id: this.buzzerId, name: name(this.buzzerId) } : null,
      winner: this.winnerId ? { id: this.winnerId, name: name(this.winnerId) } : null,
      players: this.publicPlayers(),
      fx: this.fx,
      settings: this.settings,
    };
  }
  hostView() {
    const v = this.view();
    v.code = this.code;
    if (this.current()) v.round.title = this.current().title;
    const played = new Map();
    for (const g of this.history) {
      for (const r of g.rounds) {
        const key = r.title.toLowerCase();
        played.set(key, (played.get(key) ?? 0) + 1);
      }
    }
    v.library = this.library.map(({ id: rid, title, duration, size }) => ({
      id: rid, title, duration, size, played: played.get(title.toLowerCase()) ?? 0,
    }));
    v.playlist = this.playlist;
    v.quizName = this.quizName;
    v.quizzes = this.quizzes.map((q) => ({ id: q.id, name: q.name, count: q.ids.length }));
    v.currentId = this.currentId;
    return v;
  }
  stats() {
    const people = new Map();
    const series = new Map();
    const person = (name) => {
      const key = name.toLowerCase();
      if (!people.has(key)) {
        people.set(key, { name, games: 0, wins: 0, points: 0, right: 0, wrong: 0, fastest: null });
      }
      return people.get(key);
    };
    for (const g of [...this.history].reverse()) {
      const best = Math.max(...g.players.map((p) => p.score));
      for (const p of g.players) {
        const s = person(p.name);
        s.games += 1;
        s.points += p.score;
        if (p.score === best && best > 0) s.wins += 1;
      }
      for (const r of g.rounds) {
        const key = r.title.toLowerCase();
        if (!series.has(key)) series.set(key, { title: r.title, plays: 0, guessed: 0, msSum: 0 });
        const t = series.get(key);
        t.plays += 1;
        if (r.winner) {
          const s = person(r.winner);
          s.right += 1;
          if (r.ms !== null && (s.fastest === null || r.ms < s.fastest)) s.fastest = r.ms;
          t.guessed += 1;
          t.msSum += r.ms ?? 0;
        }
        for (const name of r.wrong) person(name).wrong += 1;
      }
    }
    return {
      players: [...people.values()].sort((a, b) => b.wins - a.wins || b.points - a.points || a.name.localeCompare(b.name, 'de')),
      series: [...series.values()]
        .map(({ title, plays, guessed, msSum }) => ({ title, plays, guessed, avgMs: guessed ? Math.round(msSum / guessed) : null }))
        .sort((a, b) => b.plays - a.plays || a.title.localeCompare(b.title, 'de')),
      games: this.history,
    };
  }
  deleteGame(gid) {
    const before = this.history.length;
    this.history = this.history.filter((g) => g.id !== gid);
    return before !== this.history.length && this.changed();
  }
  toJSON() {
    const tokenOf = new Map([...this.tokens].map(([t, p]) => [p, t]));
    return {
      library: this.library, playlist: this.playlist, quizzes: this.quizzes, quizName: this.quizName,
      history: this.history, gameId: this.gameId, startedAt: this.startedAt, rounds: this.rounds,
      settings: this.settings, code: this.code,
      phase: this.phase, currentId: this.currentId, locked: [...this.locked],
      buzzerId: this.buzzerId, winnerId: this.winnerId, pos: this.position(),
      players: [...this.players.values()].map((p) => ({
        id: p.id, name: p.name, score: p.score, token: tokenOf.get(p.id),
      })),
    };
  }
}

module.exports = { Game, id, START_LEAD_MS, RESUME_LEAD_MS };
