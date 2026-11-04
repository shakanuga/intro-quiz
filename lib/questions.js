'use strict';
// Fragen prüfen und aus CSV-Dateien lesen.

const ALIASES = {
  buzzer: 'buzzer', frage: 'buzzer', offen: 'buzzer', schnellrunde: 'buzzer',
  auswahl: 'choice', choice: 'choice', mc: 'choice', 'multiple choice': 'choice',
  eintippen: 'text', text: 'text', tippen: 'text', 'frage für alle': 'text',
  schätzen: 'estimate', schaetzen: 'estimate', schätzfrage: 'estimate', estimate: 'estimate',
  sortieren: 'order', order: 'order', reihenfolge: 'order',
  zuordnen: 'match', match: 'match', paare: 'match',
  ordnungshüter: 'rank', ordnungshueter: 'rank', 'die ordnungshüter': 'rank', einordnen: 'rank', rank: 'rank',
};
const MAX_TEXT = 500;

const clean = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
const compare = (s) => clean(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function parseNumber(value) {
  const m = String(value ?? '').match(/-?\d[\d.,]*/);
  if (!m) return null;
  let t = m[0].replace(/[.,]$/, '');
  if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  else t = t.replace(/\.(?=.*\.)/g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function normalize(raw) {
  const type = ALIASES[clean(raw.type).toLowerCase()];
  if (!type) return { ok: false, error: 'Unbekannter Typ. Erlaubt sind Buzzer, Auswahl, Eintippen, Schätzen, Sortieren, Ordnungshüter und Zuordnen.' };
  const question = clean(raw.question).slice(0, MAX_TEXT);
  if (!question) return { ok: false, error: 'Die Frage fehlt.' };
  const list = Array.isArray(raw.options) ? raw.options : String(raw.options ?? '').split('|');
  const options = list.map((o) => clean(o).slice(0, 200)).filter(Boolean);
  let answer = clean(raw.answer).slice(0, MAX_TEXT);
  const note = clean(raw.note).slice(0, MAX_TEXT);
  const pointsText = clean(raw.points);
  const points = pointsText === '' ? null : Math.trunc(Number(pointsText));
  if (points !== null && (!Number.isFinite(points) || points < 0 || points > 100)) {
    return { ok: false, error: 'Punkte müssen zwischen 0 und 100 liegen.' };
  }
  const q = { kind: 'question', type, title: question, question, options: [], answer, correct: null, note, points };

  if (type === 'choice') {
    if (options.length < 2 || options.length > 8) return { ok: false, error: 'Auswahlfragen brauchen 2 bis 8 Optionen.' };
    const letter = answer.match(/^([A-Ha-h])(?:\)|\.|:|$)/);
    const byText = options.findIndex((o) => compare(o) === compare(answer.replace(/^[A-Ha-h]\)\s*/, '')));
    const index = byText >= 0 ? byText : letter ? letter[1].toUpperCase().charCodeAt(0) - 65 : -1;
    if (index < 0 || index >= options.length) return { ok: false, error: 'Die Lösung passt zu keiner Option.' };
    q.options = options;
    q.correct = index;
    q.answer = options[index];
  } else if (type === 'order') {
    if (options.length < 2 || options.length > 10) return { ok: false, error: 'Sortierfragen brauchen 2 bis 10 Einträge in der richtigen Reihenfolge.' };
    q.options = options;
    q.answer = options.join(', ');
  } else if (type === 'match') {
    const split = options.map((o) => {
      const i = o.indexOf('=');
      return i >= 0 ? [clean(o.slice(0, i)), clean(o.slice(i + 1))] : [o, ''];
    });
    const pairs = split.filter(([left, right]) => left && right);
    q.decoys = split.filter(([left, right]) => !left && right).map(([, right]) => right);
    if (pairs.length < 2 || pairs.length > 30) return { ok: false, error: 'Zuordnen braucht 2 bis 30 Paare im Format Begriff=Gegenstück.' };
    if (pairs.length + q.decoys.length !== split.length) return { ok: false, error: 'Jeder Eintrag braucht die Form Begriff=Gegenstück oder =Köder.' };
    q.options = pairs.map(([left]) => left);
    q.values = pairs.map(([, right]) => right);
    q.answer = pairs.map(([left, right]) => `${left}: ${right}`).join(', ');
  } else if (type === 'rank') {
    if (options.length < 3 || options.length > 30) return { ok: false, error: 'Ordnungshüter-Listen brauchen 3 bis 30 Einträge in der richtigen Reihenfolge.' };
    const split = options.map((o) => {
      const i = o.lastIndexOf('=');
      return i > 0 ? [clean(o.slice(0, i)), clean(o.slice(i + 1))] : [o, ''];
    });
    q.options = split.map(([label]) => label);
    q.values = split.map(([, value]) => value);
    q.answer = q.options.join(', ');
  } else {
    if (!answer) return { ok: false, error: 'Die Lösung fehlt.' };
    if (type === 'estimate') {
      q.correct = parseNumber(answer);
      if (q.correct === null) return { ok: false, error: 'Schätzfragen brauchen eine Zahl als Lösung.' };
    }
  }
  return { ok: true, q };
}

function parseCsv(text) {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0];
  const count = (c) => firstLine.split(c).length - 1;
  const sep = [';', '\t', ','].sort((a, b) => count(b) - count(a))[0];
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') {
      quoted = true;
    } else if (c === sep) {
      row.push(cell); cell = '';
    } else if (c === '\n') {
      row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = '';
    } else {
      cell += c;
    }
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const HEADERS = {
  typ: 'type', type: 'type', frage: 'question', question: 'question',
  optionen: 'options', options: 'options', loesung: 'answer', lösung: 'answer', answer: 'answer',
  erklaerung: 'note', erklärung: 'note', note: 'note', punkte: 'points', points: 'points',
};

function importCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { questions: [], intros: [], errors: [{ row: 1, error: 'Die Datei enthält keine Fragen.' }] };
  const columns = rows[0].map((h) => HEADERS[clean(h).toLowerCase()]);
  if (!columns.includes('question') || !columns.includes('type')) {
    return { questions: [], intros: [], errors: [{ row: 1, error: 'Die erste Zeile braucht mindestens die Spalten typ und frage.' }] };
  }
  const questions = [];
  const intros = [];
  const errors = [];
  rows.slice(1).forEach((cells, i) => {
    const raw = {};
    columns.forEach((key, c) => { if (key) raw[key] = cells[c]; });
    // Intros liegen schon auf dem Server, die Zeile verweist nur über den Titel darauf.
    if (clean(raw.type).toLowerCase() === 'intro') {
      const title = clean(raw.question);
      if (title) intros.push({ row: i + 2, title });
      else errors.push({ row: i + 2, error: 'Der Titel fehlt.' });
      return;
    }
    const r = normalize(raw);
    if (r.ok) questions.push(r.q);
    else errors.push({ row: i + 2, error: r.error });
  });
  return { questions, intros, errors };
}

module.exports = { normalize, importCsv, parseCsv, parseNumber, compare };
