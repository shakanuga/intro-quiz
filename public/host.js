import { h, clock, answerText, Link, Engine, scoreRows } from './quiz.js';

const $ = (id) => document.getElementById(id);
const app = $('app');
let state = null;
let link = null;
let engine = null;
let lastFx = null;
let uploads = [];
let cols = null;
let tab = 'spiel';
let search = '';
let stats = null;
let library = [];
let imports = [];
let editing = null;
let editError = '';
const LIST_LIMIT = 300;
const TABS = { spiel: 'Spiel', intros: 'Inhalte', statistik: 'Statistik' };
const MODE_NAMES = { intro: 'Intro-Quiz', fragen: '50 Fragen', ordnung: 'Ordnungshüter', zuordnen: 'Zuordnen' };
const MODE_TYPES = { fragen: ['buzzer', 'text', 'choice', 'estimate', 'order'], ordnung: ['rank'], zuordnen: ['match'] };
const TYPE_NAMES = { buzzer: 'Buzzer', choice: 'Auswahl', text: 'Eintippen', estimate: 'Schätzen', order: 'Sortieren', rank: 'Ordnungshüter', match: 'Zuordnen' };

const cmd = (a, extra = {}) => link.send({ t: 'cmd', a, ...extra });

function loginView(error = '') {
  const pw = h('input', { id: 'pw', type: 'password', required: true, autocomplete: 'current-password' });
  app.replaceChildren(h('form', {
    class: 'beitreten',
    onsubmit: async (e) => {
      e.preventDefault();
      const r = await fetch('/api/host/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw.value }),
      });
      if (r.ok) { boot(true); return; }
      const body = await r.json().catch(() => ({}));
      loginView(body.error ?? 'Die Anmeldung ist fehlgeschlagen.');
    },
  },
  h('h1', {}, 'Anmelden'),
  h('label', { for: 'pw' }, 'Host-Passwort'), pw,
  error ? h('p', { class: 'fehler', role: 'alert' }, error) : null,
  h('button', { class: 'knopf gelb', type: 'submit' }, 'Anmelden')));
  pw.focus();
}

function boot(gesture) {
  link = new Link({
    role: 'host',
    onStatus(up) { $('netz').hidden = up; },
    onMessage(m) {
      if (m.t === 'needLogin') { link.stop(); cols = null; state = null; $('reiter').hidden = true; loginView('Deine Anmeldung ist abgelaufen.'); return; }
      if (m.t === 'library') { library = m.library; render(); return; }
      if (m.t === 'questionSaved') {
        editError = m.error ?? '';
        if (m.ok) editing = null;
        render();
        return;
      }
      if (m.t === 'stats') { stats = m.stats; if (tab === 'statistik') render(); return; }
      if (m.t !== 'state') return;
      if (lastFx !== null && m.state.fx.n > lastFx) engine.effect(m.state.fx.kind);
      lastFx = m.state.fx.n;
      state = m.state;
      engine.sync(state);
      render();
    },
  });
  engine = new Engine({
    link,
    onLoaded(id, buffer) {
      cmd('duration', { id, ms: buffer.duration * 1000 });
      render();
    },
    onUnlock() { render(); },
    onError() {
      uploads = ['Das Intro dieser Runde lässt sich nicht abspielen. Prüfe die Datei oder lösche sie.', ...uploads].slice(0, 6);
      render();
    },
  });
  if (gesture) engine.unlock();
  buildShell();
}

function buildShell() {
  cols = {
    ablauf: h('section', { class: 'spalte', id: 'ablauf' }),
    regie: h('section', { class: 'spalte regie', id: 'regie' }),
    punkte: h('section', { class: 'spalte', id: 'punkte' }),
    quizze: h('section', { class: 'spalte', id: 'quizze' }),
    sammlung: h('section', { class: 'spalte', id: 'sammlung' }),
    bilanz: h('section', { class: 'spalte', id: 'bilanz' }),
    spiele: h('section', { class: 'spalte', id: 'spiele' }),
  };
  cols.punkteListe = h('div', { class: 'stapel' });
  cols.punkteRegeln = h('div', { class: 'stapel' });
  cols.punkte.append(cols.punkteListe, cols.punkteRegeln);
  $('reiter').hidden = false;
  $('reiter').replaceChildren(...Object.entries(TABS).map(([key, label]) => h('button', {
    'data-tab': key,
    onclick: () => openTab(key),
  }, label)));
  openTab('spiel');
}

function openTab(key) {
  tab = key;
  for (const b of $('reiter').children) {
    if (b.dataset.tab === key) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  document.body.dataset.reiter = key;
  const shown = {
    spiel: [cols.regie, cols.punkte, cols.ablauf],
    intros: [cols.quizze, cols.sammlung],
    statistik: [cols.bilanz, cols.spiele],
  }[key];
  app.replaceChildren(...shown);
  if (key === 'statistik') cmd('stats');
  render();
}

// ---------- Regie ----------
const button = (label, a, cls = '', key = null) => h('button', {
  class: `knopf ${cls}`, onclick: () => cmd(a), 'data-key': key,
}, label, key ? h('kbd', {}, key === ' ' ? 'Leertaste' : key.toUpperCase()) : null);

function actions(s) {
  const lastRound = s.round.n >= s.round.total;
  switch (s.phase) {
    case 'lobby':
      return [s.playlist.length
        ? button('Spiel starten', 'start', 'gelb')
        : h('p', { class: 'hinweis-text' }, 'Füge unter „Inhalte“ etwas hinzu oder lade ein gespeichertes Quiz.')];
    case 'ready':
      if (['rank', 'match'].includes(s.round.type)) {
        return s.players.filter((p) => p.online).length > 1
          ? [button('Liste starten', 'play', 'gelb', ' '), button('Ohne Spiel auflösen', 'reveal')]
          : [h('p', { class: 'hinweis-text' }, 'Dafür braucht es mindestens zwei Spieler.'), button('Ohne Spiel auflösen', 'reveal')];
      }
      return s.round.kind === 'question'
        ? [button('Frage zeigen', 'play', 'gelb', ' '), button('Ohne Antworten auflösen', 'reveal')]
        : [button('Intro abspielen', 'play', 'gelb', ' '), button('Ohne Buzzer auflösen', 'reveal')];
    case 'asking':
      return s.round.type === 'buzzer'
        ? [button('Auflösen', 'reveal')]
        : [button('Antworten schließen', 'closeAnswers', 'gelb', ' '), button('Ohne Wertung auflösen', 'reveal')];
    case 'review': return [button('Wertung abschließen', 'finishReview', 'gelb', ' ')];
    case 'sorting': return [button('Zug überspringen', 'skipTurn'), button('Ohne Punkte beenden', 'reveal')];
    case 'matching': return [button('Zug überspringen', 'skipTurn'), button('Runde beenden', 'reveal')];
    case 'playing': return [button('Pause', 'pause', '', ' '), button('Auflösen', 'reveal')];
    case 'paused': return [button('Weiter abspielen', 'resume', 'gelb', ' '), button('Auflösen', 'reveal')];
    case 'judging': return [button('Richtig', 'correct', 'gruen', 'r'), button('Falsch', 'wrong', 'rot', 'f')];
    case 'reveal': return [
      button(lastRound ? 'Ergebnis zeigen' : 'Nächste Runde', 'next', 'gelb', 'n'),
      s.outro || s.round.kind === 'question' ? null : button('Intro zu Ende spielen', 'playOn'),
    ];
    default: return [];
  }
}

const STATUS = {
  lobby: 'Warten auf Spieler', ready: 'Bereit', playing: 'Intro läuft', paused: 'Pause',
  judging: 'Antwort prüfen', reveal: 'Aufgelöst', finished: 'Spiel beendet',
  asking: 'Frage läuft', review: 'Antworten werten', sorting: 'Einordnen läuft', matching: 'Zuordnen läuft',
};

function rankPanel(s) {
  const r = s.round;
  const placed = new Set((s.rank?.placed ?? []).map((p) => p.text));
  return h('div', { class: 'frage-host' },
    h('p', { class: 'hinweis-text' }, `Ordnungshüter, ${r.points} ${r.points === 1 ? 'Punkt' : 'Punkte'}. Teams: nur der Sieger punktet. Einzeln: jeder Platz einen weniger.`),
    s.rank ? h('ul', { class: 'parteien' }, s.rank.units.map((u) => h('li', { class: `${u.out ? 'raus' : ''}${u.name === s.rank.turn && s.phase === 'sorting' ? ' dran' : ''}` },
      `${u.name}: ${u.out ? 'raus' : `${u.errors} Fehler`}`))) : null,
    s.rank?.last ? h('p', { class: s.rank.last.right ? 'letzter gut' : 'letzter schlecht' },
      `${s.rank.last.unit}: ${s.rank.last.item} ${s.rank.last.right ? 'war richtig.' : 'war falsch.'}`) : null,
    h('ol', { class: 'optionen zahlen' }, r.solution.map((o, i) => h('li', { class: placed.has(o) ? 'richtig' : '' },
      r.values[i] ? `${o}: ${r.values[i]}` : o))));
}

function matchPanel(s) {
  const r = s.round;
  const found = new Set((s.match?.done ?? []).map((p) => p.left));
  return h('div', { class: 'frage-host' },
    h('p', { class: 'hinweis-text' }, `Zuordnen, ${r.points} ${r.points === 1 ? 'Punkt' : 'Punkte'} je Paar. Bei einem Fehler ist die nächste Partei dran.`),
    s.match ? h('ul', { class: 'parteien' }, s.match.units.map((u) => h('li', { class: u.name === s.match.turn && s.phase === 'matching' ? 'dran' : '' },
      `${u.name}: ${u.points}, ${u.errors} Fehler`))) : null,
    s.match?.last ? h('p', { class: s.match.last.right ? 'letzter gut' : 'letzter schlecht' },
      `${s.match.last.unit}: ${s.match.last.pair} ${s.match.last.right ? 'gehören zusammen.' : 'passen nicht.'}`) : null,
    h('ul', { class: 'optionen paarliste' }, r.solution.map((o, i) => h('li', { class: found.has(o) ? 'richtig' : '' }, `${o}: ${r.values[i]}`))),
    r.decoys.length ? h('p', { class: 'hinweis-text' }, `Köder: ${r.decoys.join(', ')}`) : null);
}

function modePicker(s) {
  const lobby = s.phase === 'lobby';
  return h('div', { class: 'modi', role: 'group', 'aria-label': 'Spielmodus' },
    Object.entries(MODE_NAMES).map(([key, label]) => h('button', {
      class: `knopf klein${key === s.mode ? ' aktiv' : ''}`, 'data-mode': key,
      'aria-pressed': key === s.mode ? 'true' : 'false',
      disabled: !lobby && key !== s.mode,
      onclick: () => cmd('setMode', { mode: key }),
    }, label)));
}

function questionPanel(s) {
  const r = s.round;
  if (r.type === 'rank') return rankPanel(s);
  if (r.type === 'match') return matchPanel(s);
  const solution = r.type === 'choice' || r.type === 'order' ? r.solution : [];
  return h('div', { class: 'frage-host' },
    h('p', { class: 'hinweis-text' }, `${TYPE_NAMES[r.type]}, ${r.points} ${r.points === 1 ? 'Punkt' : 'Punkte'}`),
    h('p', { class: 'loesung' }, `Lösung: ${r.title}`),
    r.type === 'choice' ? h('ol', { class: 'optionen' }, solution.map((o, i) => h('li', { class: i === r.correct ? 'richtig' : '' }, o))) : null,
    r.note ? h('p', { class: 'hinweis-text' }, r.note) : null);
}

function reviewPanel(s) {
  if (!s.review.length) return h('p', { class: 'hinweis-text' }, 'Niemand hat geantwortet.');
  const pts = s.round.points;
  return h('ul', { class: 'wertung' }, s.review.map((r) => h('li', {},
    h('span', { class: 'name' }, r.name, h('span', { class: 'antwort' }, r.answer)),
    h('span', { class: 'mini' },
      h('button', { 'aria-label': `${r.name} richtig`, title: 'Richtig', onclick: () => cmd('setAward', { id: r.id, points: pts }) }, '✓'),
      h('button', { 'aria-label': `${r.name} falsch`, title: 'Falsch', onclick: () => cmd('setAward', { id: r.id, points: 0 }) }, '✗'),
      h('button', { 'aria-label': `${r.name} einen Punkt weniger`, onclick: () => cmd('setAward', { id: r.id, points: r.points - 1 }) }, '−'),
      h('button', { 'aria-label': `${r.name} einen Punkt mehr`, onclick: () => cmd('setAward', { id: r.id, points: r.points + 1 }) }, '+')),
    h('span', { class: `punkte${r.points > 0 ? ' plus' : ''}` }, String(r.points)))));
}

function regie(s) {
  const online = s.players.filter((p) => p.online);
  const loaded = online.filter((p) => p.loaded).length;
  const joinUrl = `${location.origin}/?code=${s.code}`;
  const nodes = [modePicker(s)];
  nodes.push(h('div', { class: 'status' },
    h('p', { class: 'vorzeile' }, STATUS[s.phase]),
    s.round.question ? h('p', { class: 'frage' }, s.round.question)
      : s.round.title ? h('h1', {}, s.round.title) : h('h1', {}, s.phase === 'finished' ? (s.players[0]?.name ?? 'Niemand') : 'Intro-Quiz'),
    s.round.question && s.phase !== 'finished' ? questionPanel(s) : null,
    s.phase === 'asking' && s.round.type !== 'buzzer' ? h('p', { class: 'geladen' }, `${online.filter((p) => p.answered).length} von ${online.length} Spielern haben geantwortet`) : null,
    s.phase === 'review' ? reviewPanel(s) : null,
    s.buzzer ? h('p', { class: 'wer' }, `${s.buzzer.name} antwortet`) : null,
    s.answerEnds ? h('p', { id: 'antwortzeit', class: 'antwortzeit' }, answerText(s.answerEnds, link.serverNow())) : null,
    s.phase === 'ready' && s.round.kind === 'intro' ? h('p', { class: 'geladen' }, `${loaded} von ${online.length} Spielern haben das Intro geladen`) : null,
    s.phase === 'playing' || s.outro ? h('p', { id: 'hostzeit', class: 'zeit' }, '0:00') : null));
  nodes.push(h('div', { class: 'aktionen' }, actions(s)));
  if (!engine.unlocked) {
    nodes.push(h('button', { class: 'knopf', onclick: async () => { await engine.unlock(); render(); } }, 'Ton für mich einschalten'));
  }
  nodes.push(h('div', { class: 'einladung' },
    h('div', {}, h('p', { class: 'vorzeile' }, 'Spielcode'), h('p', { class: 'code' }, s.code)),
    h('button', { class: 'knopf', onclick: (e) => { navigator.clipboard?.writeText(joinUrl); e.target.textContent = 'Link kopiert'; } }, 'Link kopieren')));
  nodes.push(h('div', { class: 'neben' },
    s.phase !== 'lobby' ? h('button', { class: 'knopf klein', onclick: () => cmd('restartRound') }, 'Runde neu starten') : null,
    !['lobby', 'finished'].includes(s.phase) ? h('button', { class: 'knopf klein', onclick: () => cmd('finish') }, 'Spiel beenden') : null,
    s.phase !== 'lobby' ? h('button', {
      class: 'knopf klein',
      onclick: () => { if (window.confirm('Noch ein Spiel mit denselben Spielern? Die Punkte starten wieder bei null.')) cmd('rematch'); },
    }, 'Nochmal mit denselben Spielern') : null,
    h('button', {
      class: 'knopf klein',
      onclick: () => { if (window.confirm('Neues Spiel mit neuem Code starten? Alle Spieler fliegen raus. Gespielte Runden landen in der Statistik.')) cmd('newGame'); },
    }, 'Neues Spiel')));
  return nodes;
}

// ---------- Punkte ----------
function punkte(s) {
  const adjust = (p) => h('span', { class: 'mini' },
    h('select', {
      class: 'teamwahl', 'aria-label': `Team von ${p.name}`,
      onchange: (e) => { cmd('setTeam', { id: p.id, team: e.target.value }); e.target.blur(); },
    }, ['', 1, 2, 3, 4].map((t) => h('option', { value: t, selected: String(p.team ?? '') === String(t) }, t ? `T${t}` : '–'))),
    h('button', { 'aria-label': `${p.name} einen Punkt abziehen`, onclick: () => cmd('adjust', { id: p.id, delta: -1 }) }, '−'),
    h('button', { 'aria-label': `${p.name} einen Punkt geben`, onclick: () => cmd('adjust', { id: p.id, delta: 1 }) }, '+'),
    h('button', {
      'aria-label': `${p.name} entfernen`,
      onclick: () => { if (window.confirm(`${p.name} aus dem Spiel entfernen?`)) cmd('kick', { id: p.id }); },
    }, '×'));
  const right = h('input', { type: 'number', min: 0, max: 100, value: s.settings.right, id: 'p-r' });
  const wrong = h('input', { type: 'number', min: -100, max: 0, value: s.settings.wrong, id: 'p-f' });
  const seconds = h('input', { type: 'number', min: 0, max: 120, value: s.settings.answerSeconds, id: 'p-z' });
  const multi = h('input', { type: 'checkbox', id: 'p-m', checked: s.settings.multiBuzz });
  const save = (e) => {
    cmd('settings', { right: right.value, wrong: wrong.value, answerSeconds: seconds.value, multiBuzz: multi.checked });
    e.target.blur(); // Sonst bleibt die Punkteliste stehen, solange das Feld den Fokus hat.
  };
  for (const input of [right, wrong, seconds, multi]) input.addEventListener('change', save);
  const list = [
    h('h2', {}, `Punkte (${s.players.filter((p) => p.online).length} online)`),
    s.players.length ? h('ol', { class: 'liste' }, scoreRows(s.players, { extra: adjust })) : h('p', { class: 'hinweis-text' }, 'Noch niemand beigetreten.'),
  ];
  const rules = [
    h('div', { class: 'regeln' },
      h('label', { for: 'p-r' }, 'Richtig'), right,
      h('label', { for: 'p-f' }, 'Falsch'), wrong),
    s.players.length > 1 ? h('div', { class: 'neben' },
      h('button', { class: 'knopf klein', onclick: () => cmd('randomTeams', { count: 2 }) }, 'Zwei Teams auslosen'),
      s.players.some((p) => p.team) ? h('button', { class: 'knopf klein', onclick: () => cmd('clearTeams') }, 'Teams auflösen') : null) : null,
    h('label', { class: 'option', for: 'p-z' }, 'Antwortzeit in Sekunden (0 = aus)', seconds),
    h('label', { class: 'option haken', for: 'p-m' }, multi, 'Nach falscher Antwort erneut buzzern'),
  ];
  return { list, rules };
}

// ---------- Intros ----------
async function uploadFiles(files) {
  for (const file of files) {
    uploads = [`${file.name}: wird hochgeladen …`, ...uploads.filter((u) => !u.startsWith(file.name))].slice(0, 6);
    render();
    let msg = `${file.name}: hochgeladen`;
    try {
      const r = await fetch(`/api/host/intros?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
      if (!r.ok) msg = (await r.json().catch(() => ({}))).error ?? `${file.name}: fehlgeschlagen`;
    } catch { msg = `${file.name}: Die Verbindung ist abgebrochen.`; }
    uploads = [msg, ...uploads.filter((u) => !u.startsWith(file.name))].slice(0, 6);
    render();
  }
}

const countEntries = (s, n) => {
  const [one, many] = { intro: ['Intro', 'Intros'], fragen: ['Frage', 'Fragen'], ordnung: ['Liste', 'Listen'], zuordnen: ['Runde', 'Runden'] }[s.mode];
  return `${n} ${n === 1 ? one : many}`;
};
const byId = (rid) => library.find((r) => r.id === rid);

function ablauf(s) {
  const entries = s.playlist.map((rid) => byId(rid)).filter(Boolean);
  const intros = entries.filter((r) => r.kind === 'intro');
  const total = intros.reduce((sum, r) => sum + (r.duration ?? 0), 0);
  const unknown = intros.some((r) => !r.duration);
  return [
    h('h2', {}, `${s.quizName ?? 'Aktuelles Quiz'} (${entries.length})`),
    intros.length ? h('p', { class: 'hinweis-text' }, `Intros zusammen ${unknown ? 'mindestens ' : ''}${clock(total)}.`) : null,
    entries.length ? null : h('p', { class: 'hinweis-text' }, 'Das Quiz ist noch leer.'),
    entries.length > 1 ? h('button', { class: 'knopf klein', onclick: () => cmd('shuffle') }, 'Reihenfolge mischen') : null,
    h('ol', { class: 'intros' }, entries.map((r, i) => h('li', { class: r.id === s.currentId ? 'aktuell' : '' },
      h('span', { class: 'nr' }, `${i + 1}.`),
      h('input', {
        value: r.title, 'aria-label': `Lösung für Intro ${i + 1}`, maxlength: 80,
        onchange: (e) => { cmd('rename', { id: r.id, title: e.target.value }); e.target.blur(); },
      }),
      h('span', { class: 'dauer' }, r.kind === 'question' ? TYPE_NAMES[r.type] : r.duration ? clock(r.duration) : ''),
      h('span', { class: 'mini' },
        s.phase !== 'lobby' && r.id !== s.currentId
          ? h('button', { 'aria-label': `Zu ${r.title} springen`, title: 'Zu dieser Runde springen', onclick: () => cmd('goTo', { id: r.id }) }, '▶') : null,
        h('button', { 'aria-label': `${r.title} nach oben`, disabled: i === 0, onclick: () => cmd('move', { id: r.id, dir: -1 }) }, '↑'),
        h('button', { 'aria-label': `${r.title} nach unten`, disabled: i === entries.length - 1, onclick: () => cmd('move', { id: r.id, dir: 1 }) }, '↓'),
        h('button', {
          'aria-label': `${r.title} aus dem Quiz nehmen`, title: 'Aus dem Quiz nehmen',
          disabled: r.id === s.currentId,
          onclick: () => cmd('exclude', { id: r.id }),
        }, '×'))))),
  ];
}

// ---------- Intros und Quizze ----------
function quizze(s) {
  const name = h('input', { id: 'quizname', maxlength: 60, required: true, value: s.quizName ?? '', placeholder: 'Zum Beispiel Filmabend' });
  const canLoad = s.phase === 'lobby';
  return [
    modePicker(s),
    h('h2', {}, `Gespeicherte Quizze: ${MODE_NAMES[s.mode]}`),
    h('p', { class: 'hinweis-text' }, `Im aktuellen Quiz: ${countEntries(s, s.playlist.length)}. Speichere es unter einem Namen, um es später wieder zu laden. Ein gleicher Name überschreibt das alte Quiz.`),
    h('form', {
      class: 'zeilenform',
      onsubmit: (e) => { e.preventDefault(); cmd('saveQuiz', { name: name.value }); name.blur(); },
    },
    h('label', { for: 'quizname' }, 'Name'), name,
    h('button', { class: 'knopf klein', type: 'submit', disabled: !s.playlist.length }, 'Quiz speichern')),
    s.mode === 'intro' ? null : importBox(),
    s.quizzes.length ? h('ul', { class: 'quizliste' }, s.quizzes.map((q) => h('li', { class: q.name === s.quizName ? 'aktiv' : '' },
      h('span', { class: 'name' }, q.name, h('span', { class: 'hinweis' }, ` ${countEntries(s, q.count)}`)),
      h('button', { class: 'knopf klein', disabled: !canLoad, onclick: () => cmd('loadQuiz', { id: q.id }) }, 'Laden'),
      h('button', {
        class: 'knopf klein',
        onclick: () => { if (window.confirm(`Quiz „${q.name}“ löschen? Die Intros bleiben erhalten.`)) cmd('deleteQuiz', { id: q.id }); },
      }, 'Löschen')))) : h('p', { class: 'hinweis-text' }, 'Noch kein Quiz gespeichert.'),
    canLoad ? null : h('p', { class: 'hinweis-text' }, 'Modus und Quiz wählst du vor dem Spielstart. Beende dafür das laufende Spiel unter „Spiel“.'),
    canLoad && s.playlist.length ? h('button', {
      class: 'knopf klein',
      onclick: () => { if (window.confirm('Alle Intros aus dem aktuellen Quiz nehmen? Sie bleiben in der Sammlung.')) cmd('clearQuiz'); },
    }, 'Aktuelles Quiz leeren') : null,
  ];
}

// Die Dateiauswahl bleibt dasselbe Element: Würde sie neu gezeichnet, während der
// Dialog offen ist, ginge die Auswahl verloren.
const introPicker = h('input', {
  type: 'file', id: 'dateien', multiple: true, class: 'versteckt', accept: '.mp3,.m4a,.ogg,.opus,.wav,.flac,audio/*',
  onchange: (e) => { uploadFiles([...e.target.files]); e.target.value = ''; },
});
const csvPicker = h('input', {
  id: 'csv', type: 'file', multiple: true, accept: '.csv,text/csv', class: 'versteckt',
  onchange: (e) => { importFiles([...e.target.files]); e.target.value = ''; },
});

async function importFiles(files) {
  for (const file of files) {
    const name = file.name.replace(/\.[^.]+$/, '');
    let msgs;
    try {
      const buffer = await file.arrayBuffer();
      let text;
      // Ältere Excel-Versionen speichern CSV nicht als UTF-8.
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { text = new TextDecoder('windows-1252').decode(buffer); }
      const r = await fetch(`/api/host/questions?name=${encodeURIComponent(name)}`, { method: 'POST', body: text });
      const body = await r.json().catch(() => ({}));
      const rows = (body.errors ?? []).slice(0, 5).map((e) => `Zeile ${e.row}: ${e.error}`);
      const more = (body.errors?.length ?? 0) > 5 ? [`und ${body.errors.length - 5} weitere Fehler`] : [];
      msgs = [r.ok ? `${file.name}: ${body.imported} Fragen importiert` : `${file.name}: ${body.error ?? 'Der Import ist fehlgeschlagen.'}`, ...rows, ...more];
    } catch { msgs = [`${file.name}: Die Datei ließ sich nicht lesen oder senden.`]; }
    imports = [...msgs, ...imports].slice(0, 12);
    render();
  }
}

function importBox() {
  return h('div', { class: 'importbox' },
    h('h2', {}, 'Fragen importieren'),
    h('p', { class: 'hinweis-text' }, 'Jede CSV-Datei wird zu einem gespeicherten Quiz mit dem Dateinamen. Inhalte landen automatisch im passenden Spielmodus.'),
    csvPicker,
    h('label', { class: 'ablage', for: 'csv' }, 'CSV-Datei auswählen'),
    h('a', { href: '/vorlage.csv', download: 'vorlage.csv' }, 'Vorlage herunterladen'),
    imports.length ? h('ul', { class: 'meldungen' }, imports.map((u) => h('li', {}, u))) : null);
}

function questionForm() {
  const q = editing;
  const set = (key) => (e) => { editing[key] = e.target.value; };
  const lines = ['choice', 'order', 'rank', 'match'].includes(q.type);
  const fixed = ['order', 'rank', 'match'].includes(q.type);
  return h('form', {
    class: 'frageform',
    onsubmit: (e) => {
      e.preventDefault();
      cmd('saveQuestion', { question: { ...editing, type: TYPE_NAMES[editing.type], options: editing.optionText.split('\n') } });
    },
  },
  h('h2', {}, q.id ? 'Eintrag bearbeiten' : 'Neuer Eintrag'),
  h('label', { for: 'f-typ' }, 'Typ'),
  h('select', {
    id: 'f-typ', onchange: (e) => { editing.type = e.target.value; render(); },
  }, MODE_TYPES[state.mode].map((k) => h('option', { value: k, selected: k === q.type }, TYPE_NAMES[k]))),
  h('label', { for: 'f-frage' }, 'Frage'),
  h('textarea', { id: 'f-frage', rows: 2, required: true, maxlength: 500, oninput: set('question') }, q.question),
  lines ? h('label', { for: 'f-optionen' }, {
    order: 'Einträge in der richtigen Reihenfolge, je Zeile einer',
    rank: 'Einträge in der richtigen Reihenfolge, je Zeile Eintrag=Wert',
    match: 'Je Zeile Begriff=Gegenstück, Köder als =Köder',
    choice: 'Optionen, je Zeile eine',
  }[q.type]) : null,
  lines ? h('textarea', { id: 'f-optionen', rows: 4, oninput: set('optionText') }, q.optionText) : null,
  fixed ? null : h('label', { for: 'f-loesung' }, q.type === 'choice' ? 'Lösung: Text der richtigen Option oder Buchstabe' : 'Lösung'),
  fixed ? null : h('input', { id: 'f-loesung', maxlength: 500, value: q.answer, oninput: set('answer') }),
  h('label', { for: 'f-note' }, 'Erklärung (freiwillig)'),
  h('input', { id: 'f-note', maxlength: 500, value: q.note, oninput: set('note') }),
  h('label', { for: 'f-punkte' }, 'Punkte (leer = Standard)'),
  h('input', { id: 'f-punkte', type: 'number', min: 0, max: 100, value: q.points ?? '', oninput: set('points') }),
  editError ? h('p', { class: 'fehler', role: 'alert' }, editError) : null,
  h('div', { class: 'neben' },
    h('button', { class: 'knopf klein', type: 'submit' }, 'Eintrag speichern'),
    h('button', { class: 'knopf klein', type: 'button', onclick: () => { editing = null; editError = ''; render(); } }, 'Abbrechen')));
}

function sammlungRows(s, listNode, noteNode) {
  const term = search.toLowerCase();
  const inQuiz = new Set(s.playlist);
  const found = library
    .filter((r) => r.mode === s.mode)
    .filter((r) => r.title.toLowerCase().includes(term))
    .sort((a, b) => a.title.localeCompare(b.title, 'de'));
  noteNode.textContent = found.length > LIST_LIMIT ? `${LIST_LIMIT} von ${found.length} Treffern. Grenze die Suche weiter ein.` : '';
  listNode.replaceChildren(...found.slice(0, LIST_LIMIT).map((r) => {
    const dabei = inQuiz.has(r.id);
    return h('li', { class: dabei ? 'dabei' : '' },
      h('span', { class: 'mini' }, h('button', {
        'aria-label': dabei ? `${r.title} aus dem Quiz nehmen` : `${r.title} ins Quiz nehmen`,
        title: dabei ? 'Aus dem Quiz nehmen' : 'Ins Quiz nehmen',
        'aria-pressed': dabei ? 'true' : 'false',
        disabled: r.id === s.currentId,
        onclick: () => cmd(dabei ? 'exclude' : 'include', { id: r.id }),
      }, dabei ? '✓' : '+')),
      h('input', {
        value: r.title, 'aria-label': `Titel von ${r.title}`, maxlength: r.kind === 'question' ? 500 : 80,
        onchange: (e) => { cmd('rename', { id: r.id, title: e.target.value }); e.target.blur(); },
      }),
      r.played ? h('span', { class: 'gespielt', title: `Schon ${r.played}-mal gespielt` }, `${r.played}× gespielt`) : null,
      h('span', { class: 'dauer' }, r.kind === 'question' ? TYPE_NAMES[r.type] : r.duration ? clock(r.duration) : ''),
      h('span', { class: 'mini' },
        r.kind === 'question' ? h('button', {
          'aria-label': `${r.title} bearbeiten`, title: 'Bearbeiten',
          onclick: () => {
            const lines = (r.options ?? []).map((o, i) => (r.values?.[i] ? `${o}=${r.values[i]}` : o))
              .concat((r.decoys ?? []).map((d) => `=${d}`));
            editing = { ...r, optionText: lines.join('\n'), points: r.points ?? '' };
            editError = '';
            render();
          },
        }, '✎') : null,
        h('button', {
          'aria-label': `${r.title} löschen`, title: 'Löschen',
          disabled: r.id === s.currentId,
          onclick: () => { if (window.confirm(`${r.title} endgültig löschen? Der Eintrag verschwindet auch aus allen Quizzen.`)) cmd('remove', { id: r.id }); },
        }, '×')));
  }));
}

function sammlung(s) {
  const zone = h('label', {
    class: 'ablage', for: 'dateien',
    ondragover: (e) => { e.preventDefault(); zone.classList.add('ueber'); },
    ondragleave: () => zone.classList.remove('ueber'),
    ondrop: (e) => { e.preventDefault(); zone.classList.remove('ueber'); uploadFiles([...e.dataTransfer.files]); },
  }, 'Intros hierher ziehen oder auswählen');
  const list = h('ol', { class: 'intros sammlung' });
  const note = h('p', { class: 'hinweis-text' });
  const refresh = () => sammlungRows(s, list, note);
  refresh();
  const count = library.filter((r) => r.mode === s.mode).length;
  const intro = s.mode === 'intro';
  return [
    h('h2', {}, `Sammlung: ${MODE_NAMES[s.mode]} (${count})`),
    intro ? h('p', { class: 'hinweis-text' }, 'Der Dateiname wird zur Lösung, zum Beispiel „Die Simpsons.mp3“. Neue Intros landen auch im aktuellen Quiz.') : null,
    intro ? introPicker : null,
    intro ? zone : null,
    intro && uploads.length ? h('ul', { class: 'meldungen' }, uploads.map((u) => h('li', {}, u))) : null,
    intro ? null : editing ? questionForm() : h('button', {
      class: 'knopf klein',
      onclick: () => { editing = { type: MODE_TYPES[s.mode][0], question: '', optionText: '', answer: '', note: '', points: '' }; editError = ''; render(); },
    }, 'Eintrag hinzufügen'),
    count ? h('input', { id: 'suche', type: 'search', placeholder: 'Suchen', 'aria-label': 'Sammlung durchsuchen', value: search, oninput: (e) => { search = e.target.value; refresh(); } }) : null,
    note, list,
  ];
}

// ---------- Statistik ----------
const seconds = (ms) => (ms === null || ms === undefined ? '' : `${(ms / 1000).toFixed(1).replace('.', ',')} s`);
const dateText = (ms) => new Date(ms).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const table = (heads, rows) => h('div', { class: 'tabelle' }, h('table', {},
  h('thead', {}, h('tr', {}, heads.map((t) => h('th', { scope: 'col' }, t)))),
  h('tbody', {}, rows.map((row) => h('tr', {}, row.map((cell) => h('td', {}, String(cell))))))));

function bilanz(st) {
  if (!st) return [h('h2', {}, 'Statistik'), h('p', { class: 'hinweis-text' }, 'Wird geladen …')];
  if (!st.games.length) {
    return [h('h2', {}, 'Statistik'), h('p', { class: 'hinweis-text' }, 'Noch keine Spiele. Sobald ein Spiel endet, steht es hier.')];
  }
  return [
    h('h2', {}, 'Spieler'),
    table(['Name', 'Spiele', 'Siege', 'Punkte', 'Richtig', 'Falsch', 'Schnellste'], st.players.map((p) => [
      p.name, p.games, p.wins, p.points, p.right, p.wrong, seconds(p.fastest),
    ])),
    h('h2', {}, 'Serien'),
    table(['Serie', 'Gespielt', 'Erraten', 'Im Schnitt nach'], st.series.map((t) => [
      t.title, t.plays, t.guessed, seconds(t.avgMs),
    ])),
  ];
}

function spiele(st) {
  if (!st?.games.length) return [];
  return [
    h('h2', {}, `Vergangene Spiele (${st.games.length})`),
    h('div', { class: 'spieleliste' }, st.games.map((g) => {
      const best = Math.max(...g.players.map((p) => p.score));
      const winners = g.players.filter((p) => p.score === best && best > 0).map((p) => p.name).join(', ');
      return h('details', {},
        h('summary', {}, `${dateText(g.at)}: ${MODE_NAMES[g.mode] ?? 'Intro-Quiz'}, ${g.quiz ?? 'ohne Namen'}`,
          h('span', { class: 'hinweis' }, winners ? ` Sieg: ${winners}` : ' ohne Sieger')),
        table(['Name', 'Punkte'], g.players.map((p) => [p.name, p.score])),
        table(['Serie', 'Erraten von', 'Nach', 'Falsch'], g.rounds.map((r) => [
          r.title, r.winner ?? 'niemand', seconds(r.ms), r.wrong.join(', '),
        ])),
        h('button', {
          class: 'knopf klein',
          onclick: () => { if (window.confirm('Dieses Spiel aus der Statistik löschen?')) cmd('deleteGame', { id: g.id }); },
        }, 'Spiel löschen'));
    })),
  ];
}

// Eingaben nicht wegrendern, während jemand darin tippt.
function replaceUnlessEditing(node, kids) {
  const a = document.activeElement;
  if (a && node.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'file') return;
  node.replaceChildren(...kids.filter(Boolean));
}

function render() {
  if (!state || !cols) return;
  $('runde').textContent = state.round.n ? `Runde ${state.round.n}/${state.round.total}` : '';
  if (tab === 'spiel') {
    cols.regie.replaceChildren(...regie(state).filter(Boolean));
    // Die Punkteliste läuft immer weiter, auch wenn gerade ein Einstellungsfeld den Fokus hat.
    const { list, rules } = punkte(state);
    const a = document.activeElement;
    if (!(a?.classList.contains('teamwahl'))) cols.punkteListe.replaceChildren(...list.filter(Boolean));
    replaceUnlessEditing(cols.punkteRegeln, rules);
    replaceUnlessEditing(cols.ablauf, ablauf(state));
  }
  if (tab === 'intros') {
    replaceUnlessEditing(cols.quizze, quizze(state));
    replaceUnlessEditing(cols.sammlung, sammlung(state));
  }
  if (tab === 'statistik') {
    cols.bilanz.replaceChildren(...bilanz(stats));
    cols.spiele.replaceChildren(...spiele(stats));
  }
}

addEventListener('keydown', (e) => {
  if (!state || tab !== 'spiel' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')) return;
  const key = e.key.toLowerCase();
  const btn = document.querySelector(`#regie [data-key="${CSS.escape(key)}"]`);
  if (btn) { e.preventDefault(); btn.click(); }
});

setInterval(() => {
  const el = $('antwortzeit');
  if (el) el.textContent = answerText(state?.answerEnds, link.serverNow());
}, 200);

setInterval(() => {
  const el = $('hostzeit');
  if (el && state?.playing) el.textContent = clock(state.playing.from + link.serverNow() - state.playing.at);
}, 200);

(async () => {
  const r = await fetch('/api/host/me');
  if (r.ok) boot(false); else loginView();
})();
