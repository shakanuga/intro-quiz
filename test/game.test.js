'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Game } = require('../lib/game');

function setup(names = ['Anna', 'Ben', 'Cem']) {
  let t = 1000;
  const g = new Game({ now: () => t });
  g.addIntro({ id: 'a', ext: '.mp3', title: 'Die Simpsons', size: 1, duration: 60000 });
  g.addIntro({ id: 'b', ext: '.mp3', title: 'Friends', size: 1, duration: 60000 });
  const ids = names.map((name) => {
    const r = g.join({ code: g.code, name });
    assert.ok(r.ok);
    g.setOnline(r.id, true);
    return r.id;
  });
  return { g, ids, tick: (ms) => { t += ms; } };
}
function playing(g, tick) { g.start(); g.play(); tick(1000); }

test('falscher Code und doppelte Namen werden abgelehnt', () => {
  const { g } = setup();
  assert.equal(g.join({ code: 'XXXX', name: 'Dora' }).ok, false);
  assert.equal(g.join({ code: g.code, name: 'anna' }).ok, false);
  assert.equal(g.join({ code: g.code, name: 'x' }).ok, false);
});

test('Wiederkommen mit Token behält Spieler und Punkte', () => {
  const { g } = setup();
  const r = g.join({ code: g.code, name: 'Dora' });
  g.adjust(r.id, 5);
  assert.equal(g.join({ token: r.token }).id, r.id);
  assert.equal(g.players.get(r.id).score, 5);
});

test('nur der erste Buzzer zählt und der Ton stoppt', () => {
  const { g, ids, tick } = setup();
  playing(g, tick);
  assert.ok(g.buzz(ids[1]));
  assert.equal(g.buzz(ids[0]), false);
  assert.equal(g.buzzerId, ids[1]);
  assert.equal(g.phase, 'judging');
  assert.equal(g.playing, null);
  assert.ok(g.pos > 0);
});

test('Buzzern vor dem Tonstart zählt nicht', () => {
  const { g, ids } = setup();
  g.start(); g.play();
  assert.equal(g.buzz(ids[0]), false);
});

test('richtig gibt Punkte und deckt auf', () => {
  const { g, ids, tick } = setup();
  playing(g, tick);
  g.buzz(ids[0]);
  g.correct();
  assert.equal(g.players.get(ids[0]).score, 3);
  assert.equal(g.phase, 'reveal');
  assert.equal(g.view().round.title, 'Die Simpsons');
});

test('falsch zieht ab, sperrt und spielt an derselben Stelle weiter', () => {
  const { g, ids, tick } = setup();
  playing(g, tick);
  tick(4000);
  g.buzz(ids[0]);
  const pos = g.pos;
  g.wrong();
  assert.equal(g.players.get(ids[0]).score, -1);
  assert.equal(g.phase, 'playing');
  assert.equal(g.playing.from, pos);
  tick(2000);
  assert.equal(g.buzz(ids[0]), false);
  assert.ok(g.buzz(ids[1]));
});

test('wenn alle falsch lagen, wird aufgelöst', () => {
  const { g, ids, tick } = setup(['Anna', 'Ben']);
  playing(g, tick);
  g.buzz(ids[0]); g.wrong(); tick(2000);
  g.buzz(ids[1]); g.wrong();
  assert.equal(g.phase, 'reveal');
  assert.equal(g.winnerId, null);
});

test('die Lösung erreicht Spieler erst bei der Auflösung', () => {
  const { g, ids, tick } = setup();
  g.start();
  assert.ok(!JSON.stringify(g.view()).includes('Simpsons'));
  g.play(); tick(1000);
  assert.ok(!JSON.stringify(g.view()).includes('Simpsons'));
  g.buzz(ids[0]);
  assert.ok(!JSON.stringify(g.view()).includes('Simpsons'));
  assert.ok(JSON.stringify(g.hostView()).includes('Simpsons'));
});

test('die letzte Runde führt zum Ergebnis', () => {
  const { g, ids, tick } = setup();
  playing(g, tick);
  g.buzz(ids[0]); g.correct(); g.next();
  assert.equal(g.phase, 'ready');
  assert.equal(g.current().title, 'Friends');
  g.reveal(); g.next();
  assert.equal(g.phase, 'finished');
});

test('Pause und Weiter behalten die Position', () => {
  const { g, tick } = setup();
  playing(g, tick);
  tick(3000);
  g.pause();
  const pos = g.pos;
  assert.ok(pos > 0);
  tick(9000);
  g.resume();
  assert.equal(g.playing.from, pos);
});

test('Speichern und Laden erhält Spiel, Punkte und Token', () => {
  const { g, ids, tick } = setup();
  playing(g, tick);
  g.buzz(ids[2]); g.correct();
  const copy = new Game({ saved: JSON.parse(JSON.stringify(g)) });
  assert.equal(copy.players.get(ids[2]).score, 3);
  assert.equal(copy.phase, 'reveal');
  assert.equal(copy.code, g.code);
  const token = [...g.tokens].find(([, p]) => p === ids[2])[0];
  assert.equal(copy.join({ token }).id, ids[2]);
});

test('Neustart mitten im Intro landet in der Pause', () => {
  const { g, tick } = setup();
  playing(g, tick);
  const copy = new Game({ saved: JSON.parse(JSON.stringify(g)) });
  assert.equal(copy.phase, 'paused');
});

test('mit Mehrfach-Buzzern darf man nach falsch erneut buzzern', () => {
  const { g, ids, tick } = setup();
  g.setSettings({ right: 3, wrong: -1, multiBuzz: true, answerSeconds: 0 });
  playing(g, tick);
  g.buzz(ids[0]); g.wrong();
  tick(2000);
  assert.equal(g.locked.size, 0);
  assert.ok(g.buzz(ids[0]));
  g.wrong();
  assert.equal(g.players.get(ids[0]).score, -2);
  assert.equal(g.phase, 'playing');
});

test('Einschalten von Mehrfach-Buzzern hebt Sperren auf', () => {
  const { g, ids, tick } = setup();
  playing(g, tick);
  g.buzz(ids[0]); g.wrong();
  assert.equal(g.locked.size, 1);
  g.setSettings({ right: 3, wrong: -1, multiBuzz: true, answerSeconds: 0 });
  assert.equal(g.locked.size, 0);
});

test('der Countdown läuft nur als Anzeige und wertet nicht selbst', () => {
  const { g, ids, tick } = setup();
  g.setSettings({ right: 3, wrong: -1, multiBuzz: false, answerSeconds: 10 });
  playing(g, tick);
  g.buzz(ids[0]);
  const ends = g.view().answerEnds;
  assert.ok(ends > 0);
  tick(60000);
  assert.equal(g.phase, 'judging');
  g.correct();
  assert.equal(g.view().answerEnds, null);
});

test('ohne Antwortzeit gibt es keinen Countdown', () => {
  const { g, ids, tick } = setup();
  playing(g, tick);
  g.buzz(ids[0]);
  assert.equal(g.view().answerEnds, null);
});

test('ungültige Einstellungen werden abgelehnt', () => {
  const { g } = setup();
  assert.equal(g.setSettings({ right: 3, wrong: -1, multiBuzz: false, answerSeconds: 999 }), false);
  assert.equal(g.setSettings({ right: 3, wrong: 1, multiBuzz: false, answerSeconds: 5 }), false);
});

test('alte Spielstände bekommen die neuen Einstellungen', () => {
  const g = new Game({ saved: { settings: { right: 5, wrong: -2 } } });
  assert.deepEqual(g.settings, { right: 5, wrong: -2, multiBuzz: false, answerSeconds: 0 });
});
