import { h, store, clock, answerText, Link, Engine, scoreRows } from './quiz.js';

const $ = (id) => document.getElementById(id);
let token = store.get('quiz_token');
let state = null;
let mode = null;
let joinError = '';
let lastFx = null;

const link = new Link({
  onOpen() { if (token) link.send({ t: 'hello', token }); else render(); },
  onStatus(up) { $('netz').hidden = up; },
  onMessage(m) {
    if (m.t === 'joined') {
      token = m.token;
      store.set('quiz_token', token);
      joinError = '';
    }
    if (m.t === 'error') {
      if (m.forget) { token = null; store.del('quiz_token'); }
      joinError = m.forget ? '' : m.error;
      mode = null;
      render();
    }
    if (m.t === 'kicked') {
      token = null;
      store.del('quiz_token');
      state = null;
      joinError = m.reason;
      mode = null;
      engine.stop();
      render();
    }
    if (m.t === 'state') {
      if (lastFx !== null && m.state.fx.n > lastFx) engine.effect(m.state.fx.kind);
      lastFx = m.state.fx.n;
      state = m.state;
      engine.sync(state);
      // Auch ein schon geladenes Intro melden, etwa wenn die Runde neu startet.
      const self = state.players.find((p) => p.id === state.me);
      if (self && !self.loaded && engine.has(state.round.audio)) link.send({ t: 'loaded', id: state.round.audio });
      render();
    }
  },
});

const engine = new Engine({
  link,
  headers: () => ({ 'x-player-token': token ?? '' }),
  onLoaded(id) { link.send({ t: 'loaded', id }); render(); },
  onError() { render(); },
  onUnlock() { render(); },
});
engine.volume(Number(store.get('quiz_vol') ?? 0.8));

const buzzerOpen = () => mode === 'buzzer' || mode?.startsWith('fragebuzzer');
const question = () => h('p', { class: 'frage' }, state.round.question ?? '');

function buzz() {
  if (!buzzerOpen()) return;
  link.send({ t: 'buzz' });
  navigator.vibrate?.(40);
  const b = document.querySelector('.buzzer');
  b?.classList.add('gedrueckt');
  setTimeout(() => b?.classList.remove('gedrueckt'), 220);
}
addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !e.repeat && buzzerOpen()) { e.preventDefault(); buzz(); }
});

function eq() {
  return h('div', { class: 'eq', 'aria-hidden': 'true' }, [1, 2, 3, 4, 5, 6, 7].map(() => h('i')));
}

function joinView() {
  const code = h('input', {
    id: 'code', autocomplete: 'off', autocapitalize: 'characters', maxlength: 4, required: true,
    spellcheck: 'false', class: 'code-feld', value: new URLSearchParams(location.search).get('code') ?? '',
  });
  const name = h('input', { id: 'name', autocomplete: 'nickname', maxlength: 20, required: true, value: store.get('quiz_name') ?? '' });
  const submit = async (e) => {
    e.preventDefault();
    store.set('quiz_name', name.value);
    await engine.unlock();
    link.send({ t: 'hello', code: code.value, name: name.value });
  };
  return h('form', { class: 'beitreten', onsubmit: submit },
    h('h1', {}, 'Mitspielen'),
    h('label', { for: 'name' }, 'Dein Name'), name,
    h('label', { for: 'code' }, 'Spielcode'), code,
    joinError ? h('p', { class: 'fehler', role: 'alert' }, joinError) : null,
    h('button', { class: 'knopf gelb', type: 'submit' }, 'Beitreten'));
}

function buzzerButton(extra = '') {
  return h('button', { class: `buzzer ${extra}`, onpointerdown: (e) => { e.preventDefault(); buzz(); }, onclick: buzz, 'aria-label': 'Buzzer drücken' },
    h('span', { class: 'sockel' }), h('span', { class: 'kappe' }, 'Buzzer'));
}

const send = (value) => link.send({ t: 'answer', value });

function textInput(number) {
  const field = h('input', {
    id: 'antwort', autocomplete: 'off', maxlength: 300, 'aria-label': 'Deine Antwort', inputmode: number ? 'decimal' : 'text',
    value: state.myAnswer ?? '',
  });
  return h('form', {
    class: 'antwortform',
    onsubmit: (e) => { e.preventDefault(); if (field.value.trim()) send(field.value); field.blur(); },
  }, field, h('button', { class: 'knopf gelb', type: 'submit' }, 'Antwort abgeben'));
}

function choiceInput() {
  return h('div', { class: 'auswahl' }, state.round.options.map((o, i) => h('button', {
    class: 'knopf', 'data-option': o, onclick: () => send(i),
  }, `${String.fromCharCode(65 + i)}) ${o}`)));
}

function orderInput() {
  const shown = state.round.options;
  let order = shown.map((_, i) => i);
  const list = h('ol', { class: 'sortieren' });
  const draw = () => list.replaceChildren(...order.map((item, pos) => h('li', {},
    h('span', { class: 'name' }, shown[item]),
    h('span', { class: 'mini' },
      h('button', { 'aria-label': `${shown[item]} nach oben`, disabled: pos === 0, onclick: () => swap(pos, pos - 1) }, '↑'),
      h('button', { 'aria-label': `${shown[item]} nach unten`, disabled: pos === order.length - 1, onclick: () => swap(pos, pos + 1) }, '↓')))));
  const swap = (a, b) => {
    order = [...order];
    [order[a], order[b]] = [order[b], order[a]];
    draw();
  };
  draw();
  return h('div', { class: 'antwortform' }, list, h('button', { class: 'knopf gelb', onclick: () => send(order) }, 'Reihenfolge abgeben'));
}

function waiting(title, text) {
  return h('div', { class: 'tafelbild' }, h('h1', {}, title), h('p', {}, text));
}

const views = {
  lobby: () => h('div', { class: 'tafelbild' },
    h('h1', {}, 'Du bist dabei'),
    h('p', {}, 'Gleich geht es los. Prüfe kurz deinen Ton.'),
    h('button', { class: 'knopf', onclick: () => engine.effect('test') }, 'Ton testen'),
    volumeControl()),
  ready: () => {
    if (state.round.kind === 'question') return waiting(`Runde ${state.round.n}`, 'Gleich kommt die Frage.');
    const has = engine.has(state.round.audio);
    return waiting(`Runde ${state.round.n}`, has ? 'Bereit. Das Intro startet gleich.' : 'Intro wird geladen …');
  },
  fragebuzzer: () => h('div', { class: 'buzzer-feld' }, question(), buzzerButton('klein'),
    h('p', { class: 'tipp' }, 'Oder drücke die Leertaste')),
  fragegesperrt: () => h('div', { class: 'tafelbild gesperrt-bild' }, question(),
    h('h1', {}, 'Gesperrt'),
    h('p', {}, 'Du warst falsch. Die anderen dürfen jetzt buzzern.')),
  eingabe: () => {
    const { type } = state.round;
    const input = { text: () => textInput(false), estimate: () => textInput(true), choice: choiceInput, order: orderInput }[type]();
    return h('div', { class: 'eingabe' }, question(), input,
      h('p', { id: 'gespeichert', class: 'gespeichert' }),
      h('p', { id: 'antwortzeit', class: 'antwortzeit' }));
  },
  pruefen: () => h('div', { class: 'tafelbild' }, question(),
    h('p', {}, state.myAnswer ? `Deine Antwort: ${state.myAnswer}` : 'Du hast nicht geantwortet.'),
    h('p', { class: 'vorzeile' }, 'Die Antworten werden geprüft.')),
  buzzer: () => h('div', { class: 'buzzer-feld' },
    buzzerButton(),
    h('div', { class: 'laufband' }, eq(), h('span', { id: 'zeit', class: 'zeit' }, '0:00')),
    h('p', { class: 'tipp' }, 'Oder drücke die Leertaste')),
  locked: () => h('div', { class: 'tafelbild gesperrt-bild' },
    h('h1', {}, 'Gesperrt'),
    h('p', {}, 'Du warst falsch. Die anderen dürfen jetzt buzzern.'),
    eq()),
  meine: () => h('div', { class: 'tafelbild treffer' },
    state.round.question ? question() : null,
    h('h1', {}, 'Du bist dran'),
    h('p', {}, 'Sag deine Antwort in Discord.'),
    h('p', { id: 'antwortzeit', class: 'antwortzeit' })),
  fremd: () => h('div', { class: 'tafelbild treffer fremd' },
    state.round.question ? question() : null,
    h('h1', {}, state.buzzer?.name ?? 'Jemand'),
    h('p', {}, 'hat gebuzzert und antwortet in Discord.'),
    h('p', { id: 'antwortzeit', class: 'antwortzeit' })),
  pause: () => waiting('Pause', 'Das Intro geht gleich weiter.'),
  reveal: () => {
    const { results } = state;
    const lead = state.winner ? `Richtig, ${state.winner.name}!`
      : results.length ? 'Die Lösung' : 'Niemand hat es erraten.';
    return h('div', { class: 'tafelbild aufloesung' },
      state.round.question ? question() : null,
      h('p', { class: 'vorzeile' }, lead),
      h('h1', {}, state.round.title ?? ''),
      state.round.note ? h('p', {}, state.round.note) : null,
      results.length ? h('ul', { class: 'ergebnisse' }, results.map((r) => h('li', { class: r.points > 0 ? 'treffer-zeile' : '' },
        h('span', { class: 'name' }, r.name), h('span', {}, r.answer), h('span', { class: 'punkte' }, r.points > 0 ? `+${r.points}` : String(r.points))))) : null,
      state.outro ? eq() : null);
  },
  ende: () => {
    const top = state.players.slice(0, 3);
    return h('div', { class: 'tafelbild ende' },
      h('p', { class: 'vorzeile' }, 'Gewonnen hat'),
      h('h1', {}, top[0]?.name ?? 'Niemand'),
      h('p', {}, top[0] ? `mit ${top[0].score} Punkten` : ''));
  },
};

function volumeControl() {
  const value = Number(store.get('quiz_vol') ?? 0.8);
  return h('label', { class: 'regler' }, 'Lautstärke',
    h('input', {
      type: 'range', min: 0, max: 1, step: 0.05, value,
      oninput: (e) => { engine.volume(Number(e.target.value)); store.set('quiz_vol', e.target.value); },
    }));
}

function pickMode() {
  if (!state) return 'join';
  const s = state;
  if (s.phase === 'lobby') return 'lobby';
  if (s.phase === 'ready') return `ready:${engine.has(s.round.audio)}:${s.round.n}`;
  if (s.phase === 'asking' && s.round.type === 'buzzer') return s.locked ? `fragegesperrt:${s.round.n}` : `fragebuzzer:${s.round.n}`;
  if (s.phase === 'asking') return `eingabe:${s.round.n}:${s.round.type}`;
  if (s.phase === 'review') return `pruefen:${s.round.n}`;
  if (s.phase === 'playing') return s.locked ? 'locked' : 'buzzer';
  if (s.phase === 'paused') return 'pause';
  if (s.phase === 'judging') return s.buzzer?.id === s.me ? 'meine' : `fremd:${s.buzzer?.id}`;
  if (s.phase === 'reveal') return `reveal:${s.round.n}:${s.outro}`;
  return 'ende';
}

function render() {
  if (!state && token) return; // Wiederverbinden läuft
  const next = pickMode();
  if (next !== mode) {
    mode = next;
    const base = next.split(':')[0];
    $('stage').replaceChildren(base === 'join' ? joinView() : views[base]());
    document.body.dataset.modus = base;
  }
  if (!state) { $('tafel').hidden = true; $('runde').textContent = ''; return; }
  const saved = $('gespeichert');
  if (saved) saved.textContent = state.myAnswer ? `Gespeichert: ${state.myAnswer}. Du kannst noch ändern.` : '';
  for (const b of document.querySelectorAll('[data-option]')) {
    b.classList.toggle('gewaehlt', b.dataset.option === state.myAnswer);
  }
  $('runde').textContent = state.round.n ? `Runde ${state.round.n}/${state.round.total}` : '';
  $('tafel').hidden = false;
  $('liste').replaceChildren(...scoreRows(state.players, { me: state.me }));
  const band = $('ton');
  band.hidden = engine.unlocked;
  if (!engine.unlocked && !band.firstChild) {
    band.append(h('button', { class: 'knopf gelb', onclick: async () => { await engine.unlock(); render(); } }, 'Ton einschalten'));
  }
}

setInterval(() => {
  const el = $('antwortzeit');
  if (el) el.textContent = answerText(state?.answerEnds, link.serverNow());
}, 200);

setInterval(() => {
  const el = $('zeit');
  if (!el || !state?.playing) return;
  el.textContent = clock(state.playing.from + link.serverNow() - state.playing.at);
  const dur = engine.buffers.get(state.round.audio)?.duration;
  if (dur && link.serverNow() - state.playing.at + state.playing.from > dur * 1000) {
    el.textContent = 'Intro zu Ende. Du kannst noch buzzern.';
    document.querySelector('.eq')?.classList.add('still');
  }
}, 200);

render();
