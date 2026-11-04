'use strict';
// Spiellogik ohne Netzwerk, damit sie sich direkt testen lässt.
// Die Uhr des Servers entscheidet über alles: Wer zuerst ankommt, hat gebuzzert.
const crypto = require('crypto');
const { normalize, parseNumber, compare } = require('./questions');

const START_LEAD_MS = 900;   // Vorlauf, damit der Ton bei allen gleichzeitig startet
const RESUME_LEAD_MS = 1500; // Kurze Pause, bevor das Intro nach "Falsch" weiterläuft
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MAX_PLAYERS = 40;
const MAX_HISTORY = 500;
const MAX_QUIZZES = 200;
const MAX_LIBRARY = 10000;

const id = (bytes = 12) => crypto.randomBytes(bytes).toString('hex');
const newCode = () => Array.from({ length: 4 }, () => CODE_LETTERS[crypto.randomInt(CODE_LETTERS.length)]).join('');
const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();

function shuffled(list) {
  const out = [...list];
  do {
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = crypto.randomInt(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
  } while (list.length > 1 && out.every((x, i) => x === list[i]));
  return out;
}

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
      this.players.set(p.id, { id: p.id, name: p.name, score: p.score, team: p.team ?? null, online: false, loaded: null });
      this.tokens.set(p.token, p.id);
    }
    this.code = saved?.code ?? newCode();
    this.phase = saved?.phase ?? 'lobby';
    this.currentId = saved?.currentId ?? null;
    this.locked = new Set(saved?.locked ?? []);
    this.buzzerId = saved?.buzzerId ?? null;
    this.winnerId = saved?.winnerId ?? null;
    this.pos = saved?.pos ?? 0;
    this.askedAt = 0;
    this.answers = new Map(saved?.answers ?? []);
    this.results = saved?.results ?? [];
    this.orderShown = saved?.orderShown ?? [];
    this.rank = saved?.rank ?? null;
    this.match = saved?.match ?? null;
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
  question() { const c = this.current(); return c?.kind === 'question' ? c : null; }
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
    this.rounds.push({
      id: rid, title: this.current().title, kind: this.current().kind ?? 'intro',
      winner: null, correct: [], wrong: [], ms: null, done: false,
    });
    this.phase = 'ready';
    this.pos = 0;
    this.outro = false;
    this.buzzerId = null;
    this.answerEnds = null;
    this.winnerId = null;
    this.locked.clear();
    this.answers.clear();
    this.results = [];
    this.orderShown = [];
    this.rank = null;
    this.match = null;
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
      rounds: rounds.map(({ title, kind, winner, correct, wrong, ms }) => ({ title, kind, winner, correct, wrong, ms })),
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
    this.answers.clear();
    this.results = [];
    this.orderShown = [];
    this.rank = null;
    this.match = null;
    this.gameId = id(6);
    this.startedAt = null;
    this.rounds = [];
  }
  // Nach "Falsch" geht es weiter: Bei Intros läuft der Ton, bei Fragen sind die Buzzer wieder offen.
  reopen() {
    if (this.question()) {
      this.phase = 'asking';
    } else {
      this.phase = 'playing';
      this.startAudio(RESUME_LEAD_MS);
    }
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
    this.players.set(pid, { id: pid, name: clean, score: 0, team: null, online: false, loaded: null });
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
    const asking = this.phase === 'asking' && this.question()?.type === 'buzzer';
    const listening = this.phase === 'playing' && this.playing && this.now() >= this.playing.at;
    if (!asking && !listening) return false; // Bei Intros zählt ein Buzzer erst, wenn der Ton läuft.
    if (!this.players.has(pid) || this.locked.has(pid)) return false;
    this.stopAudio();
    if (asking) this.pos = this.now() - this.askedAt;
    this.buzzerId = pid;
    // Der Countdown ist nur eine Anzeige: Gewertet wird immer vom Host.
    const secs = this.settings.answerSeconds;
    this.answerEnds = secs > 0 ? this.now() + secs * 1000 : null;
    this.phase = 'judging';
    this.effect('buzz');
    return this.changed();
  }

  submitAnswer(pid, value) {
    const q = this.question();
    if (this.phase !== 'asking' || !q || q.type === 'buzzer' || !this.players.has(pid)) return false;
    let answer = null;
    if (q.type === 'choice') {
      const i = Number(value);
      if (Number.isInteger(i) && i >= 0 && i < q.options.length) answer = { raw: i, text: q.options[i] };
    } else if (q.type === 'text') {
      const t = cleanName(value).slice(0, 300);
      if (t) answer = { raw: t, text: t };
    } else if (q.type === 'estimate') {
      const n = parseNumber(value);
      if (n !== null) answer = { raw: n, text: String(n).replace('.', ',') };
    } else if (q.type === 'order') {
      const valid = Array.isArray(value) && value.length === q.options.length
        && [...new Set(value)].length === value.length
        && value.every((i) => Number.isInteger(i) && i >= 0 && i < q.options.length);
      if (valid) {
        const raw = value.map((i) => this.orderShown[i]);
        answer = { raw, text: raw.join(', ') };
      }
    }
    if (!answer) return false;
    this.answers.set(pid, answer);
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
    const q = this.question();
    if (q?.type === 'rank') return this.startRank(q);
    if (q?.type === 'match') return this.startMatch(q);
    if (q) {
      this.askedAt = this.now();
      this.phase = 'asking';
      if (q.type === 'order') this.orderShown = shuffled(q.options);
      const secs = this.settings.answerSeconds;
      if (q.type !== 'buzzer' && secs > 0) this.answerEnds = this.now() + secs * 1000;
      return this.changed();
    }
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
    if (p) p.score += this.question()?.points ?? this.settings.right;
    this.closeRound({ winner: p?.name ?? null, correct: p ? [p.name] : [], ms: Math.round(this.pos) });
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
      this.reopen();
    } else {
      this.closeRound();
      this.phase = 'reveal';
    }
    return this.changed();
  }
  reveal() {
    if (this.phase === 'matching') return this.finishMatch();
    if (!['playing', 'paused', 'ready', 'asking', 'sorting'].includes(this.phase)) return false;
    this.stopAudio();
    this.answerEnds = null;
    this.closeRound();
    this.winnerId = null;
    this.phase = 'reveal';
    return this.changed();
  }
  // Beendet die Antwortphase. Eintippfragen gehen zum Host, alles andere wertet sich selbst.
  closeAnswers() {
    const q = this.question();
    if (this.phase !== 'asking' || !q || q.type === 'buzzer') return false;
    this.answerEnds = null;
    const pts = q.points ?? this.settings.right;
    const entries = [...this.answers].map(([pid, a]) => ({
      id: pid, name: this.players.get(pid)?.name ?? '?', answer: a.text, raw: a.raw, points: 0,
    }));
    if (q.type === 'choice') {
      for (const e of entries) e.points = e.raw === q.correct ? pts : 0;
    } else if (q.type === 'order') {
      for (const e of entries) e.points = e.raw.join('\n') === q.options.join('\n') ? pts : 0;
    } else if (q.type === 'estimate') {
      const best = Math.min(...entries.map((e) => Math.abs(e.raw - q.correct)));
      for (const e of entries) e.points = Math.abs(e.raw - q.correct) === best ? pts : 0;
    } else {
      for (const e of entries) e.points = compare(e.raw) === compare(q.answer) ? pts : 0;
      this.results = entries;
      this.phase = 'review';
      return this.changed();
    }
    this.results = entries;
    this.applyResults();
    return this.changed();
  }
  setAward(pid, points) {
    const e = this.results.find((r) => r.id === pid);
    const n = Math.trunc(Number(points));
    if (this.phase !== 'review' || !e || !Number.isFinite(n) || Math.abs(n) > 100) return false;
    e.points = n;
    return this.changed();
  }
  finishReview() {
    if (this.phase !== 'review') return false;
    this.applyResults();
    return this.changed();
  }
  applyResults() {
    for (const e of this.results) {
      const p = this.players.get(e.id);
      if (p) p.score += e.points;
    }
    this.closeRound({
      correct: this.results.filter((e) => e.points > 0).map((e) => e.name),
      wrong: this.results.filter((e) => e.points <= 0).map((e) => e.name),
    });
    this.effect('right');
    this.phase = 'reveal';
  }
  // ---------- Die Ordnungshüter ----------
  // Teams oder Einzelne ordnen abwechselnd Einträge in eine wachsende Liste ein.
  // Der erste Fehler ist frei, beim zweiten scheidet man aus.
  buildUnits() {
    const units = new Map();
    const online = this.active();
    for (const p of online) {
      const key = p.team ? `team-${p.team}` : `solo-${p.id}`;
      if (!units.has(key)) units.set(key, { key, name: p.team ? `Team ${p.team}` : p.name, team: !!p.team, members: [], errors: 0, out: null });
      units.get(key).members.push(p.id);
    }
    return [...units.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }
  startRank(q) {
    const units = this.buildUnits();
    if (units.length < 2) return false;
    // Die Anzeige nutzt eigene Nummern, damit niemand die Lösung aus den Daten lesen kann.
    const pool = shuffled(q.options.map((_, i) => i));
    const first = pool[0];
    this.rank = {
      units,
      pool,
      teamMode: units.every((u) => u.team),
      placed: [first],
      remaining: pool.slice(1),
      turn: (this.index()) % units.length,
      outCount: 0,
      last: null,
    };
    this.phase = 'sorting';
    return this.changed();
  }
  rankUnitOf(pid) { return this.rank?.units.find((u) => u.members.includes(pid)) ?? null; }
  placeItem(pid, poolId, slot) {
    const r = this.rank;
    const q = this.question();
    if (this.phase !== 'sorting' || !r || !q) return false;
    const unit = r.units[r.turn];
    if (!unit?.members.includes(pid)) return false;
    const item = r.pool[poolId];
    if (!r.remaining.includes(item) || !Number.isInteger(slot) || slot < 0 || slot > r.placed.length) return false;
    const before = r.placed[slot - 1] ?? -Infinity;
    const after = r.placed[slot] ?? Infinity;
    const right = before < item && item < after;
    r.remaining = r.remaining.filter((x) => x !== item);
    r.placed = [...r.placed, item].sort((a, b) => a - b);
    r.last = { unit: unit.name, item: q.options[item], right };
    if (!right) {
      unit.errors += 1;
      if (unit.errors >= 2) {
        r.outCount += 1;
        unit.out = r.outCount;
      }
    }
    this.effect(right ? 'right' : 'wrong');
    const alive = r.units.filter((u) => u.out === null && u.members.length);
    if (!r.remaining.length || alive.length <= 1) return this.finishRank(q);
    this.nextRankTurn();
    return this.changed();
  }
  nextRankTurn() {
    const r = this.rank ?? this.match;
    for (let i = 1; i <= r.units.length; i += 1) {
      const next = (r.turn + i) % r.units.length;
      if (r.units[next].out === null && r.units[next].members.length) { r.turn = next; return; }
    }
  }
  skipTurn() {
    if (!['sorting', 'matching'].includes(this.phase)) return false;
    this.nextRankTurn();
    return this.changed();
  }
  finishRank(q) {
    const r = this.rank;
    const pts = q.points ?? this.settings.right;
    // Wer drin bleibt, liegt vorn, danach zählen weniger Fehler und spätes Ausscheiden.
    const score = (u) => (u.out === null ? 1000 - u.errors : u.out);
    const sorted = [...r.units].sort((a, b) => score(b) - score(a));
    const topTie = sorted.filter((u) => score(u) === score(sorted[0])).length > 1;
    const award = new Map();
    if (r.teamMode) {
      // Teams: Nur der Sieger punktet. Bei Gleichstand gibt es keine Punkte.
      if (!topTie) award.set(sorted[0].key, pts);
    } else {
      // Einzeln: Platz 1 bekommt die vollen Punkte, jeder weitere Platz einen weniger.
      let place = 0;
      sorted.forEach((u, i) => {
        if (i > 0 && score(u) !== score(sorted[i - 1])) place = i;
        award.set(u.key, Math.max(pts - place, 0));
      });
    }
    this.results = sorted.map((u) => {
      const points = award.get(u.key) ?? 0;
      for (const pid of u.members) {
        const p = this.players.get(pid);
        if (p) p.score += points;
      }
      return { id: u.key, name: u.name, answer: u.out === null ? `${u.errors} Fehler` : 'ausgeschieden', points };
    });
    const best = Math.max(...this.results.map((e) => e.points));
    const winners = sorted.filter((u) => best > 0 && award.get(u.key) === best)
      .flatMap((u) => u.members.map((pid) => this.players.get(pid)?.name)).filter(Boolean);
    this.closeRound({ correct: winners });
    r.remaining = [];
    r.placed = q.options.map((_, i) => i);
    this.phase = 'reveal';
    return this.changed();
  }
  // ---------- Zuordnen ----------
  // Wer dran ist, bildet Paare, bis ein Paar falsch ist. Dann ist die nächste Partei dran.
  // Ein falsches Paar wird nicht aufgelöst, und jedes richtige Paar gibt sofort Punkte.
  startMatch(q) {
    const units = this.buildUnits();
    if (units.length < 2) return false;
    const rights = shuffled([...q.values, ...(q.decoys ?? [])]);
    this.match = {
      units: units.map((u) => ({ ...u, points: 0 })),
      teamMode: units.every((u) => u.team),
      lefts: shuffled(q.options.map((_, i) => i)),
      rights: rights.map((text) => ({ text, used: false })),
      done: [],
      turn: this.index() % units.length,
      last: null,
    };
    this.phase = 'matching';
    return this.changed();
  }
  pairItems(pid, leftId, rightId) {
    const m = this.match;
    const q = this.question();
    if (this.phase !== 'matching' || !m || !q) return false;
    const unit = m.units[m.turn];
    if (!unit?.members.includes(pid)) return false;
    const left = m.lefts[leftId];
    const right = m.rights[rightId];
    if (left === undefined || !right || right.used || m.done.includes(left)) return false;
    const correct = right.text === q.values[left];
    const label = `${q.options[left]} und ${right.text}`;
    m.last = { unit: unit.name, pair: label, right: correct };
    if (correct) {
      const pts = q.points ?? 1;
      right.used = true;
      m.done.push(left);
      unit.points += pts;
      for (const member of unit.members) {
        const p = this.players.get(member);
        if (p) p.score += pts;
      }
    } else {
      unit.errors += 1;
      this.nextRankTurn();
    }
    this.effect(correct ? 'right' : 'wrong');
    if (m.done.length === q.options.length) return this.finishMatch();
    return this.changed();
  }
  finishMatch() {
    const m = this.match;
    if (!m) return false;
    const sorted = [...m.units].sort((a, b) => b.points - a.points);
    this.results = sorted.map((u) => ({ id: u.key, name: u.name, answer: `${u.errors} Fehler`, points: u.points }));
    const best = sorted[0]?.points ?? 0;
    const winners = sorted.filter((u) => best > 0 && u.points === best)
      .flatMap((u) => u.members.map((pid) => this.players.get(pid)?.name)).filter(Boolean);
    this.closeRound({ correct: winners });
    this.phase = 'reveal';
    return this.changed();
  }
  matchView() {
    const m = this.match;
    const q = this.question();
    if (!m || !q) return null;
    const open = this.phase === 'matching';
    return {
      units: m.units.map((u) => ({ name: u.name, members: u.members, errors: u.errors, points: u.points })),
      turn: m.units[m.turn]?.name ?? null,
      turnMembers: m.units[m.turn]?.members ?? [],
      lefts: m.lefts.map((item, i) => ({ id: i, item })).filter((x) => open && !m.done.includes(x.item))
        .map((x) => ({ id: x.id, text: q.options[x.item] })),
      rights: m.rights.map((r, i) => ({ id: i, text: r.text, used: r.used })).filter((r) => open && !r.used)
        .map(({ id: rid, text }) => ({ id: rid, text })),
      done: (open ? m.done : q.options.map((_, i) => i)).map((i) => ({ left: q.options[i], right: q.values[i] })),
      decoys: open ? [] : q.decoys ?? [],
      last: m.last,
    };
  }
  setTeam(pid, team) {
    const p = this.players.get(pid);
    const t = team === null || team === '' ? null : Math.trunc(Number(team));
    if (!p || (t !== null && (!Number.isFinite(t) || t < 1 || t > 8))) return false;
    p.team = t;
    return this.changed();
  }
  randomTeams(count = 2) {
    const list = shuffled([...this.active()]);
    list.forEach((p, i) => { p.team = (i % count) + 1; });
    return list.length ? this.changed() : false;
  }
  clearTeams() {
    for (const p of this.players.values()) p.team = null;
    return this.changed();
  }
  rankView() {
    const r = this.rank;
    const q = this.question();
    if (!r || !q) return null;
    return {
      units: r.units.map((u) => ({ name: u.name, members: u.members, errors: u.errors, out: u.out !== null })),
      turn: r.units[r.turn]?.name ?? null,
      turnMembers: r.units[r.turn]?.members ?? [],
      placed: r.placed.map((i) => ({ text: q.options[i], value: q.values?.[i] ?? '' })),
      remaining: r.pool.map((item, poolId) => ({ id: poolId, text: q.options[item] })).filter((x) => r.remaining.includes(r.pool[x.id])),
      last: r.last,
    };
  }
  playOn() {
    if (this.phase !== 'reveal' || this.outro || this.question()) return false;
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
    this.answers.delete(pid);
    this.results = this.results.filter((r) => r.id !== pid);
    if (this.rank) {
      for (const u of this.rank.units) u.members = u.members.filter((m) => m !== pid);
      if (this.phase === 'sorting' && !this.rank.units[this.rank.turn]?.members.length) this.nextRankTurn();
    }
    if (this.match) {
      for (const u of this.match.units) u.members = u.members.filter((m) => m !== pid);
      if (this.phase === 'matching' && !this.match.units[this.match.turn]?.members.length) this.nextRankTurn();
    }
    if (this.buzzerId === pid) {
      this.buzzerId = null;
      this.answerEnds = null;
      this.reopen();
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
    if (r.kind === 'question') r.question = clean;
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
  addQuestions(list, quizName) {
    if (this.library.length + list.length > MAX_LIBRARY) return null;
    const added = list.map((q) => ({ id: id(), ...q }));
    this.library.push(...added);
    const name = cleanName(quizName).slice(0, 60) || 'Importierte Fragen';
    const old = this.quizzes.find((q) => q.name.toLowerCase() === name.toLowerCase());
    if (old) this.deleteQuiz(old.id);
    const quiz = { id: id(6), name, ids: added.map((q) => q.id) };
    this.quizzes.push(quiz);
    this.changed();
    return quiz;
  }
  saveQuestion(fields) {
    const r = normalize(fields);
    if (!r.ok) return r;
    if (fields.id) {
      const i = this.library.findIndex((x) => x.id === fields.id && x.kind === 'question');
      if (i < 0) return { ok: false, error: 'Die Frage gibt es nicht mehr.' };
      this.library[i] = { id: fields.id, ...r.q };
    } else {
      const entry = { id: id(), ...r.q };
      this.library.push(entry);
      this.playlist.push(entry.id);
    }
    this.changed();
    return { ok: true };
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
    const quiz = this.quizzes.find((q) => q.id === qid);
    if (!quiz) return false;
    this.quizzes = this.quizzes.filter((q) => q.id !== qid);
    // Fragen gehören zu ihren Quizzen: Sind sie nirgends mehr drin, verschwinden sie mit.
    const used = new Set(this.quizzes.flatMap((q) => q.ids));
    const orphan = new Set(quiz.ids.filter((rid) => !used.has(rid) && rid !== this.currentId
      && this.library.find((r) => r.id === rid)?.kind === 'question'));
    this.library = this.library.filter((r) => !orphan.has(r.id));
    this.playlist = this.playlist.filter((rid) => !orphan.has(rid));
    return this.changed();
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
        id: p.id, name: p.name, score: p.score, online: p.online, team: p.team,
        loaded: p.loaded !== null && p.loaded === this.currentId,
        locked: this.locked.has(p.id),
        answered: this.answers.has(p.id),
      }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'de'));
  }
  view() {
    const cur = this.current();
    const showTitle = this.phase === 'reveal';
    const q = cur?.kind === 'question' ? cur : null;
    const visible = ['asking', 'judging', 'review', 'reveal', 'sorting', 'matching'].includes(this.phase);
    const name = (pid) => this.players.get(pid)?.name ?? null;
    return {
      phase: this.phase,
      round: cur ? {
        n: this.index() + 1,
        total: this.playlist.length,
        kind: q ? 'question' : 'intro',
        type: q?.type ?? null,
        audio: q || this.phase === 'finished' ? null : cur.id,
        duration: cur.duration ?? null,
        title: showTitle ? (q ? q.answer : cur.title) : null,
        question: q && visible ? q.question : null,
        options: q && visible && !['rank', 'match'].includes(q.type) ? (q.type === 'order' ? this.orderShown : q.options) : [],
        note: q && showTitle ? q.note : '',
      } : { n: 0, total: this.playlist.length, kind: null, type: null, audio: null, duration: null, title: null, question: null, options: [], note: '' },
      rank: ['sorting', 'reveal'].includes(this.phase) ? this.rankView() : null,
      match: ['matching', 'reveal'].includes(this.phase) ? this.matchView() : null,
      results: this.phase === 'reveal' ? this.results.map(({ name, answer, points }) => ({ name, answer, points })) : [],
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
    const cur = this.current();
    if (cur) {
      const q = cur.kind === 'question' ? cur : null;
      v.round.title = q ? q.answer : cur.title;
      if (q) {
        v.round.question = q.question;
        v.round.note = q.note;
        v.round.correct = q.correct;
        v.round.solution = q.options;
        v.round.values = q.values ?? [];
        v.round.points = q.points ?? (q.type === 'match' ? 1 : this.settings.right);
        v.round.decoys = q.decoys ?? [];
      }
    }
    v.review = this.phase === 'review' ? this.results.map(({ id: pid, name, answer, points }) => ({ id: pid, name, answer, points })) : [];
    v.playlist = this.playlist;
    v.quizName = this.quizName;
    v.quizzes = this.quizzes.map((x) => ({ id: x.id, name: x.name, count: x.ids.length }));
    v.currentId = this.currentId;
    return v;
  }
  libraryView() {
    const played = new Map();
    for (const g of this.history) {
      for (const r of g.rounds) {
        const key = r.title.toLowerCase();
        played.set(key, (played.get(key) ?? 0) + 1);
      }
    }
    return this.library.map((r) => ({
      id: r.id, kind: r.kind ?? 'intro', title: r.title, duration: r.duration,
      type: r.type, question: r.question, options: r.options, values: r.values, decoys: r.decoys, answer: r.answer, note: r.note, points: r.points,
      played: played.get(r.title.toLowerCase()) ?? 0,
    }));
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
        const intro = (r.kind ?? 'intro') === 'intro';
        if (intro && !series.has(key)) series.set(key, { title: r.title, plays: 0, guessed: 0, msSum: 0 });
        const t = intro ? series.get(key) : null;
        if (t) t.plays += 1;
        for (const name of r.correct ?? (r.winner ? [r.winner] : [])) person(name).right += 1;
        if (r.winner) {
          const s = person(r.winner);
          if (intro && r.ms !== null && (s.fastest === null || r.ms < s.fastest)) s.fastest = r.ms;
          if (t) { t.guessed += 1; t.msSum += r.ms ?? 0; }
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
      answers: [...this.answers], results: this.results, orderShown: this.orderShown, rank: this.rank, match: this.match,
      settings: this.settings, code: this.code,
      phase: this.phase, currentId: this.currentId, locked: [...this.locked],
      buzzerId: this.buzzerId, winnerId: this.winnerId, pos: this.position(),
      players: [...this.players.values()].map((p) => ({
        id: p.id, name: p.name, score: p.score, team: p.team, token: tokenOf.get(p.id),
      })),
    };
  }
}

module.exports = { Game, id, START_LEAD_MS, RESUME_LEAD_MS };
