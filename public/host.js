import { h, clock, answerText, Link, Engine, scoreRows } from './quiz.js';

const $ = (id) => document.getElementById(id);
const app = $('app');
let state = null;
let link = null;
let engine = null;
let lastFx = null;
let uploads = [];
let cols = null;

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
      if (m.t === 'needLogin') { link.stop(); cols = null; state = null; loginView('Deine Anmeldung ist abgelaufen.'); return; }
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
  };
  app.replaceChildren(cols.regie, cols.punkte, cols.ablauf);
}

// ---------- Regie ----------
const button = (label, a, cls = '', key = null) => h('button', {
  class: `knopf ${cls}`, onclick: () => cmd(a), 'data-key': key,
}, label, key ? h('kbd', {}, key === ' ' ? 'Leertaste' : key.toUpperCase()) : null);

function actions(s) {
  const lastRound = s.round.n >= s.round.total;
  switch (s.phase) {
    case 'lobby':
      return [s.library.length
        ? button('Spiel starten', 'start', 'gelb')
        : h('p', { class: 'hinweis-text' }, 'Lade zuerst Intros hoch.')];
    case 'ready': return [button('Intro abspielen', 'play', 'gelb', ' '), button('Ohne Buzzer auflösen', 'reveal')];
    case 'playing': return [button('Pause', 'pause', '', ' '), button('Auflösen', 'reveal')];
    case 'paused': return [button('Weiter abspielen', 'resume', 'gelb', ' '), button('Auflösen', 'reveal')];
    case 'judging': return [button('Richtig', 'correct', 'gruen', 'r'), button('Falsch', 'wrong', 'rot', 'f')];
    case 'reveal': return [
      button(lastRound ? 'Ergebnis zeigen' : 'Nächste Runde', 'next', 'gelb', 'n'),
      s.outro ? null : button('Intro zu Ende spielen', 'playOn'),
    ];
    default: return [];
  }
}

const STATUS = {
  lobby: 'Warten auf Spieler', ready: 'Bereit', playing: 'Intro läuft', paused: 'Pause',
  judging: 'Antwort prüfen', reveal: 'Aufgelöst', finished: 'Spiel beendet',
};

function regie(s) {
  const online = s.players.filter((p) => p.online);
  const loaded = online.filter((p) => p.loaded).length;
  const joinUrl = `${location.origin}/?code=${s.code}`;
  const nodes = [];
  nodes.push(h('div', { class: 'status' },
    h('p', { class: 'vorzeile' }, STATUS[s.phase]),
    s.round.title ? h('h1', {}, s.round.title) : h('h1', {}, s.phase === 'finished' ? (s.players[0]?.name ?? 'Niemand') : 'Intro-Quiz'),
    s.buzzer ? h('p', { class: 'wer' }, `${s.buzzer.name} antwortet`) : null,
    s.answerEnds ? h('p', { id: 'antwortzeit', class: 'antwortzeit' }, answerText(s.answerEnds, link.serverNow())) : null,
    s.phase === 'ready' ? h('p', { class: 'geladen' }, `${loaded} von ${online.length} Spielern haben das Intro geladen`) : null,
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
    h('button', {
      class: 'knopf klein',
      onclick: () => { if (window.confirm('Neues Spiel starten? Alle Spieler und Punkte werden gelöscht, die Intros bleiben.')) cmd('newGame'); },
    }, 'Neues Spiel')));
  return nodes;
}

// ---------- Punkte ----------
function punkte(s) {
  const adjust = (p) => h('span', { class: 'mini' },
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
  return [
    h('h2', {}, `Punkte (${s.players.filter((p) => p.online).length} online)`),
    s.players.length ? h('ol', { class: 'liste' }, scoreRows(s.players, { extra: adjust })) : h('p', { class: 'hinweis-text' }, 'Noch niemand beigetreten.'),
    h('div', { class: 'regeln' },
      h('label', { for: 'p-r' }, 'Richtig'), right,
      h('label', { for: 'p-f' }, 'Falsch'), wrong),
    h('label', { class: 'option', for: 'p-z' }, 'Antwortzeit in Sekunden (0 = aus)', seconds),
    h('label', { class: 'option haken', for: 'p-m' }, multi, 'Nach falscher Antwort erneut buzzern'),
  ];
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

function ablauf(s) {
  const total = s.library.reduce((sum, r) => sum + (r.duration ?? 0), 0);
  const unknown = s.library.some((r) => !r.duration);
  const picker = h('input', {
    type: 'file', id: 'dateien', multiple: true, class: 'versteckt', accept: '.mp3,.m4a,.ogg,.opus,.wav,.flac,audio/*',
    onchange: (e) => { uploadFiles([...e.target.files]); e.target.value = ''; },
  });
  const zone = h('label', {
    class: 'ablage', for: 'dateien',
    ondragover: (e) => { e.preventDefault(); zone.classList.add('ueber'); },
    ondragleave: () => zone.classList.remove('ueber'),
    ondrop: (e) => { e.preventDefault(); zone.classList.remove('ueber'); uploadFiles([...e.dataTransfer.files]); },
  }, 'Intros hierher ziehen oder auswählen');
  return [
    h('h2', {}, `Intros (${s.library.length})`),
    h('p', { class: 'hinweis-text' }, s.library.length
      ? `Gesamtlänge ${unknown ? 'mindestens ' : ''}${clock(total)}. Der Dateiname wird zur Lösung.`
      : 'Der Dateiname wird zur Lösung, zum Beispiel „Die Simpsons.mp3“.'),
    picker, zone,
    uploads.length ? h('ul', { class: 'meldungen' }, uploads.map((u) => h('li', {}, u))) : null,
    s.library.length > 1 ? h('button', { class: 'knopf klein', onclick: () => cmd('shuffle') }, 'Reihenfolge mischen') : null,
    h('ol', { class: 'intros' }, s.library.map((r, i) => h('li', { class: r.id === s.currentId ? 'aktuell' : '' },
      h('span', { class: 'nr' }, `${i + 1}.`),
      h('input', {
        value: r.title, 'aria-label': `Lösung für Intro ${i + 1}`, maxlength: 80,
        onchange: (e) => { cmd('rename', { id: r.id, title: e.target.value }); e.target.blur(); },
      }),
      h('span', { class: 'dauer' }, r.duration ? clock(r.duration) : ''),
      h('span', { class: 'mini' },
        s.phase !== 'lobby' && r.id !== s.currentId
          ? h('button', { 'aria-label': `Zu ${r.title} springen`, title: 'Zu dieser Runde springen', onclick: () => cmd('goTo', { id: r.id }) }, '▶') : null,
        h('button', { 'aria-label': `${r.title} nach oben`, disabled: i === 0, onclick: () => cmd('move', { id: r.id, dir: -1 }) }, '↑'),
        h('button', { 'aria-label': `${r.title} nach unten`, disabled: i === s.library.length - 1, onclick: () => cmd('move', { id: r.id, dir: 1 }) }, '↓'),
        h('button', {
          'aria-label': `${r.title} löschen`,
          disabled: r.id === s.currentId,
          onclick: () => { if (window.confirm(`${r.title} löschen?`)) cmd('remove', { id: r.id }); },
        }, '×'))))),
  ];
}

// Eingaben nicht wegrendern, während jemand darin tippt.
function replaceUnlessEditing(node, kids) {
  const a = document.activeElement;
  if (a && node.contains(a) && a.tagName === 'INPUT' && a.type !== 'file') return;
  node.replaceChildren(...kids.filter(Boolean));
}

function render() {
  if (!state || !cols) return;
  $('runde').textContent = state.round.n ? `Runde ${state.round.n}/${state.round.total}` : '';
  cols.regie.replaceChildren(...regie(state).filter(Boolean));
  replaceUnlessEditing(cols.punkte, punkte(state));
  replaceUnlessEditing(cols.ablauf, ablauf(state));
}

addEventListener('keydown', (e) => {
  if (!state || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
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
