'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Game } = require('../lib/game');
const { importCsv, normalize, parseNumber } = require('../lib/questions');

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

function fullGame(g, ids, tick) {
  g.start(); g.play(); tick(1000); tick(4000);
  g.buzz(ids[0]); g.wrong(); tick(2000);
  g.buzz(ids[1]); g.correct(); g.next();
  g.reveal(); g.next();
}

test('ein beendetes Spiel landet einmal in der Statistik', () => {
  const { g, ids, tick } = setup();
  fullGame(g, ids, tick);
  assert.equal(g.phase, 'finished');
  assert.equal(g.history.length, 1);
  g.finish();
  assert.equal(g.history.length, 1);
  const [game] = g.history;
  assert.equal(game.rounds.length, 2);
  assert.equal(game.rounds[0].winner, 'Ben');
  assert.deepEqual(game.rounds[0].wrong, ['Anna']);
  assert.equal(game.rounds[1].winner, null);
  assert.equal(game.players[0].name, 'Ben');
});

test('Statistik zählt Siege, Treffer und schnellste Antwort über mehrere Spiele', () => {
  const { g, ids, tick } = setup();
  fullGame(g, ids, tick);
  g.rematch();
  assert.equal(g.phase, 'lobby');
  assert.equal(g.players.size, 3);
  assert.equal(g.players.get(ids[1]).score, 0);
  fullGame(g, ids, tick);
  const s = g.stats();
  assert.equal(g.history.length, 2);
  const ben = s.players.find((p) => p.name === 'Ben');
  assert.equal(ben.games, 2);
  assert.equal(ben.wins, 2);
  assert.equal(ben.points, 6);
  assert.equal(ben.right, 2);
  assert.ok(ben.fastest > 0);
  assert.equal(s.players[0].name, 'Ben');
  assert.equal(s.players.find((p) => p.name === 'Anna').wrong, 2);
  const simpsons = s.series.find((x) => x.title === 'Die Simpsons');
  assert.equal(simpsons.plays, 2);
  assert.equal(simpsons.guessed, 2);
  assert.equal(s.series.find((x) => x.title === 'Friends').guessed, 0);
  assert.equal(g.libraryView().find((r) => r.id === 'a').played, 2);
});

test('ein Spiel ohne gespielte Runde wird nicht gespeichert', () => {
  const { g } = setup();
  g.start();
  g.newGame();
  assert.equal(g.history.length, 0);
});

test('Spiel löschen entfernt es aus der Statistik', () => {
  const { g, ids, tick } = setup();
  fullGame(g, ids, tick);
  g.deleteGame(g.history[0].id);
  assert.equal(g.stats().players.length, 0);
});

test('Quiz speichern, ändern und wieder laden', () => {
  const { g } = setup();
  g.addIntro({ id: 'c', ext: '.mp3', title: 'Lost', size: 1 });
  g.exclude('b');
  g.saveQuiz('Sci-Fi');
  assert.deepEqual(g.playlist, ['a', 'c']);
  g.clearQuiz();
  assert.equal(g.playlist.length, 0);
  g.include('b');
  const q = g.quizzes[0];
  assert.ok(g.loadQuiz(q.id));
  assert.deepEqual(g.playlist, ['a', 'c']);
  assert.equal(g.quizName, 'Sci-Fi');
  g.move('c', -1);
  g.saveQuiz('sci-fi');
  assert.equal(g.quizzes.length, 1);
  assert.deepEqual(g.quizzes[0].ids, ['c', 'a']);
  assert.equal(g.view().round.total, 2);
});

test('während des Spiels lässt sich kein Quiz laden', () => {
  const { g } = setup();
  g.saveQuiz('Alles');
  g.start();
  assert.equal(g.loadQuiz(g.quizzes[0].id), false);
});

test('das Spiel folgt der Quiz-Reihenfolge und nicht der Sammlung', () => {
  const { g, ids, tick } = setup();
  g.exclude('a');
  assert.equal(g.view().round.total, 1);
  g.start();
  assert.equal(g.current().title, 'Friends');
  g.play(); tick(1000);
  g.buzz(ids[0]); g.correct(); g.next();
  assert.equal(g.phase, 'finished');
});

test('gelöschte Intros verschwinden aus gespeicherten Quizzen', () => {
  const { g } = setup();
  g.saveQuiz('Alles');
  assert.ok(g.remove('a'));
  assert.deepEqual(g.quizzes[0].ids, ['b']);
  assert.deepEqual(g.playlist, ['b']);
});

test('alte Spielstände ohne Quiz behalten alle Intros', () => {
  const library = [{ id: 'a', ext: '.mp3', title: 'A', size: 1 }, { id: 'b', ext: '.mp3', title: 'B', size: 1 }];
  const g = new Game({ saved: { library } });
  assert.deepEqual(g.playlist, ['a', 'b']);
  assert.deepEqual(g.history, []);
});

test('Statistik und Quizze überleben einen Neustart', () => {
  const { g, ids, tick } = setup();
  g.saveQuiz('Alles');
  fullGame(g, ids, tick);
  const copy = new Game({ saved: JSON.parse(JSON.stringify(g)) });
  assert.equal(copy.history.length, 1);
  assert.equal(copy.quizzes[0].name, 'Alles');
  assert.equal(copy.stats().players.length, 3);
});

const ask = (fields) => {
  const r = normalize(fields);
  assert.ok(r.ok, r.error);
  return r.q;
};
function quizWith(questions, names = ['Anna', 'Ben', 'Cem']) {
  const ctx = setup(names);
  const quiz = ctx.g.addQuestions(questions, 'Test');
  ctx.g.loadQuiz(quiz.id);
  ctx.g.start();
  ctx.g.play();
  return ctx;
}

test('Buzzer-Frage: Frage wird gezeigt, Lösung bleibt geheim, falsch öffnet die Buzzer wieder', () => {
  const { g, ids } = quizWith([ask({ type: 'Buzzer', question: 'Wer?', answer: 'Sauron', points: '5' })]);
  assert.equal(g.phase, 'asking');
  assert.equal(g.view().round.question, 'Wer?');
  assert.ok(!JSON.stringify(g.view()).includes('Sauron'));
  assert.ok(g.buzz(ids[0]));
  g.wrong();
  assert.equal(g.phase, 'asking');
  assert.equal(g.buzz(ids[0]), false);
  g.buzz(ids[1]);
  g.correct();
  assert.equal(g.players.get(ids[1]).score, 5);
  assert.equal(g.view().round.title, 'Sauron');
});

test('Auswahl: wird automatisch gewertet und die Lösung bleibt vorher geheim', () => {
  const q = ask({ type: 'Auswahl', question: 'Was?', options: 'Liar|Rache|Help', answer: 'B' });
  assert.equal(q.answer, 'Rache');
  const { g, ids } = quizWith([q]);
  assert.ok(!JSON.stringify(g.view()).includes('"correct":1'));
  g.submitAnswer(ids[0], 1);
  g.submitAnswer(ids[1], 0);
  g.submitAnswer(ids[1], 2);
  assert.equal(g.buzz(ids[2]), false);
  g.closeAnswers();
  assert.equal(g.phase, 'reveal');
  assert.equal(g.players.get(ids[0]).score, 3);
  assert.equal(g.players.get(ids[1]).score, 0);
  assert.equal(g.view().results.length, 2);
});

test('Eintippen: Treffer sind vorgeschlagen, der Host entscheidet', () => {
  const { g, ids } = quizWith([ask({ type: 'Eintippen', question: 'Wo?', answer: 'In der Wüste Gobi' })]);
  g.submitAnswer(ids[0], 'in der wüste gobi!');
  g.submitAnswer(ids[1], 'Gobi');
  g.closeAnswers();
  assert.equal(g.phase, 'review');
  const review = g.hostView().review;
  assert.equal(review.find((r) => r.id === ids[0]).points, 3);
  assert.equal(review.find((r) => r.id === ids[1]).points, 0);
  assert.equal(g.players.get(ids[0]).score, 0);
  g.setAward(ids[1], 2);
  g.setAward(ids[0], -1);
  g.finishReview();
  assert.equal(g.players.get(ids[1]).score, 2);
  assert.equal(g.players.get(ids[0]).score, -1);
  assert.equal(g.phase, 'reveal');
  assert.deepEqual(g.rounds[0].correct, ['Ben']);
});

test('Schätzen: die nächste Zahl gewinnt, Gleichstand zählt für beide', () => {
  const { g, ids } = quizWith([ask({ type: 'Schätzen', question: 'Wie viele?', answer: '133 Tage' })]);
  g.submitAnswer(ids[0], '130');
  g.submitAnswer(ids[1], '136');
  g.submitAnswer(ids[2], '1.000');
  g.closeAnswers();
  assert.equal(g.players.get(ids[0]).score, 3);
  assert.equal(g.players.get(ids[1]).score, 3);
  assert.equal(g.players.get(ids[2]).score, 0);
});

test('Sortieren: wird gemischt gezeigt und nur die exakte Reihenfolge zählt', () => {
  const q = ask({ type: 'Sortieren', question: 'Reihenfolge?', options: 'A|B|C|D' });
  const { g, ids } = quizWith([q]);
  const shown = g.view().round.options;
  assert.notDeepEqual(shown, q.options);
  assert.deepEqual([...shown].sort(), q.options);
  g.submitAnswer(ids[0], q.options.map((o) => shown.indexOf(o)));
  g.submitAnswer(ids[1], [0, 1, 2, 3].reverse().map((i) => shown.indexOf(q.options[i])));
  assert.equal(g.submitAnswer(ids[2], [0, 0, 1, 2]), false);
  g.closeAnswers();
  assert.equal(g.players.get(ids[0]).score, 3);
  assert.equal(g.players.get(ids[1]).score, 0);
});

test('Intros und Fragen lassen sich in einem Quiz mischen', () => {
  const { g, ids, tick } = setup();
  g.saveQuestion({ type: 'Buzzer', question: 'Wer?', answer: 'Sauron' });
  assert.equal(g.playlist.length, 3);
  g.start();
  assert.equal(g.view().round.kind, 'intro');
  g.reveal(); g.next(); g.reveal(); g.next();
  assert.equal(g.view().round.kind, 'question');
  assert.equal(g.view().round.audio, null);
  g.play();
  tick(1500);
  g.buzz(ids[0]);
  assert.equal(g.pos, 1500);
});

test('Antworten überleben einen Neustart', () => {
  const { g, ids } = quizWith([ask({ type: 'Eintippen', question: 'Wo?', answer: 'Gobi' })]);
  g.submitAnswer(ids[0], 'Gobi');
  const copy = new Game({ saved: JSON.parse(JSON.stringify(g)) });
  assert.equal(copy.phase, 'asking');
  copy.closeAnswers();
  assert.equal(copy.results[0].points, 3);
});

test('Statistik zählt Fragen bei Spielern, aber nicht als Serie', () => {
  const { g, ids } = quizWith([ask({ type: 'Auswahl', question: 'Was?', options: 'X|Y', answer: 'X' })]);
  g.submitAnswer(ids[0], 0);
  g.submitAnswer(ids[1], 1);
  g.closeAnswers();
  g.next();
  const s = g.stats();
  assert.equal(s.players.find((p) => p.name === 'Anna').right, 1);
  assert.equal(s.players.find((p) => p.name === 'Ben').wrong, 1);
  assert.equal(s.series.length, 0);
});

test('Quiz löschen entfernt seine Fragen, wenn sie nirgends sonst stecken', () => {
  const { g } = setup();
  const quiz = g.addQuestions([ask({ type: 'Buzzer', question: 'Wer?', answer: 'X' })], 'Test');
  assert.equal(g.library.length, 3);
  g.deleteQuiz(quiz.id);
  assert.equal(g.library.length, 2);
});

test('derselbe Importname ersetzt das alte Quiz', () => {
  const { g } = setup();
  g.addQuestions([ask({ type: 'Buzzer', question: 'Alt?', answer: 'X' })], 'Test');
  g.addQuestions([ask({ type: 'Buzzer', question: 'Neu?', answer: 'X' })], 'test');
  assert.equal(g.quizzes.length, 1);
  assert.equal(g.library.filter((r) => r.kind === 'question').length, 1);
});

test('CSV-Import versteht Semikolon, Anführungszeichen, BOM und meldet Fehlerzeilen', () => {
  const csv = '\ufefftyp;frage;optionen;loesung;erklaerung;punkte\r\n'
    + 'Buzzer;"Wer sagt ""Hallo""; und?";;Ich;Weil;5\r\n'
    + 'Auswahl;Was?;A1|A2;B;;\r\n'
    + 'Quatsch;Was?;;X;;\r\n'
    + 'Schätzen;Wie viele?;;keine Ahnung;;\r\n'
    + 'Sortieren;Reihe?;Eins|Zwei;;;\r\n';
  const { questions, errors } = importCsv(csv);
  assert.equal(questions.length, 3);
  assert.equal(questions[0].question, 'Wer sagt "Hallo"; und?');
  assert.equal(questions[0].points, 5);
  assert.equal(questions[1].correct, 1);
  assert.deepEqual(errors.map((e) => e.row), [4, 5]);
});

test('Zahlen werden deutsch gelesen', () => {
  assert.equal(parseNumber('1.000'), 1000);
  assert.equal(parseNumber('1,5'), 1.5);
  assert.equal(parseNumber('ca. 133 Tage'), 133);
  assert.equal(parseNumber('nichts'), null);
});
