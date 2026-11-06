// Spielregeln für Host und Spieler. Der Text richtet sich nach Modus und Einstellungen.
import { h } from './quiz.js';

export const MODE_NAMES = { intro: 'Intro-Quiz', fragen: '50 Fragen', ordnung: 'Ordnungshüter', zuordnen: 'Zuordnen' };

const pts = (n) => `${n} ${Math.abs(n) === 1 ? 'Punkt' : 'Punkte'}`;
const section = (title, ...items) => h('section', { class: 'regelblock' },
  h('h3', {}, title), h('ul', {}, items.flat().filter(Boolean).map((t) => h('li', {}, t))));

function buzzerRules(s, what) {
  return [
    `Wer ${what}, drückt den Buzzer – auf dem Handy antippen, am PC geht auch die Leertaste.`,
    'Wer zuerst buzzert, ist dran und sagt die Antwort in Discord. Alle anderen warten.',
    s.answerSeconds > 0 ? `Für die Antwort hast du ${s.answerSeconds} Sekunden.` : null,
    `Richtig gibt ${pts(s.right)}. ${s.wrong < 0 ? `Falsch kostet ${pts(-s.wrong)}` : 'Falsch kostet nichts'}.`,
    s.multiBuzz
      ? 'Nach einer falschen Antwort darfst du in derselben Runde erneut buzzern.'
      : 'Nach einer falschen Antwort bist du für diese Runde gesperrt, die anderen dürfen weiter buzzern.',
  ];
}

function modeRules(mode, s) {
  if (mode === 'intro') {
    return [
      section('So läuft eine Runde',
        'Bei allen läuft gleichzeitig das Intro einer Serie.',
        buzzerRules(s, 'die Serie erkennt'),
        'Gebuzzert werden kann erst, wenn der Ton läuft. Nach einer falschen Antwort läuft das Intro weiter.',
        'Kommt niemand drauf, löst der Host auf.'),
      section('Ton',
        'Schalte vor dem Start den Ton ein und teste ihn. Die Lautstärke stellst du in der Wartezeit ein.',
        'Das Intro kommt nicht über Discord, sondern direkt über diese Seite. Discord-Musik lieber leise drehen.'),
    ];
  }
  if (mode === 'fragen') {
    return [
      section('So läuft eine Runde',
        'Zu jedem Quiz gibt es Fragen in verschiedenen Arten. Oben steht immer die Frage, darunter siehst du, wie du antwortest.',
        `Eine Frage bringt normalerweise ${pts(s.right)}. Manche Fragen sind mehr oder weniger wert.`),
      section('Buzzer-Fragen', buzzerRules(s, 'die Antwort weiß')),
      section('Fragen für alle',
        'Alle antworten gleichzeitig auf ihrem Gerät. Bis der Host die Antworten schließt, kannst du deine Antwort noch ändern.',
        s.answerSeconds > 0 ? `Dafür habt ihr ${s.answerSeconds} Sekunden.` : null,
        'Auswahl: Tippe eine der Möglichkeiten an.',
        'Eintippen: Schreib die Antwort ins Feld. Der Host prüft danach alle Antworten und zählt auch Tippfehler als richtig, wenn er will.',
        'Schätzen: Gib eine Zahl ein. Wer am nächsten dran ist, bekommt die Punkte – bei Gleichstand alle.',
        'Sortieren: Bring die Einträge in die richtige Reihenfolge. Punkte gibt es nur, wenn alles stimmt.'),
    ];
  }
  if (mode === 'ordnung') {
    return [
      section('So läuft eine Runde',
        'Es gibt eine Liste mit Einträgen, die nach etwas geordnet sind, etwa nach Jahr oder Größe. Ein Eintrag liegt schon da.',
        'Ihr seid abwechselnd dran – als Teams, wenn der Host Teams gebildet hat, sonst jeder für sich.',
        'Wer dran ist, wählt einen Eintrag und setzt ihn an die Stelle in der Liste, an die er gehört.',
        'Der erste Fehler ist frei. Beim zweiten Fehler scheidet man aus.',
        'Die Runde endet, wenn alle Einträge liegen oder nur noch eine Partei übrig ist.'),
      section('Punkte',
        `Teams: Nur das Siegerteam bekommt ${pts(s.right)}, bei Gleichstand gibt es keine Punkte.`,
        `Einzeln: Platz 1 bekommt ${pts(s.right)}, jeder weitere Platz einen Punkt weniger.`,
        'Wer drin bleibt, liegt vorn. Danach zählen weniger Fehler und spätes Ausscheiden.',
        'Im Team sprecht ihr euch in Discord ab. Jedes Teammitglied darf für das Team klicken.'),
    ];
  }
  if (mode === 'zuordnen') {
    return [
      section('So läuft eine Runde',
        'Links stehen Begriffe, rechts ihre Gegenstücke. Rechts sind auch ein paar falsche Köder dabei.',
        'Ihr seid abwechselnd dran – als Teams, wenn der Host Teams gebildet hat, sonst jeder für sich.',
        'Wer dran ist, wählt links einen Begriff und rechts sein Gegenstück.',
        'Jedes richtige Paar gibt sofort einen Punkt und du darfst weitermachen.',
        'Ein falsches Paar beendet deinen Zug. Es wird nicht verraten, was richtig gewesen wäre.',
        'Die Runde endet, wenn alle Paare gefunden sind.'),
    ];
  }
  return [];
}

function hostRules(mode) {
  const items = {
    intro: ['Nach einem Buzzer wertest du mit Richtig (R) oder Falsch (F). Die Leertaste startet und pausiert das Intro.'],
    fragen: ['Bei Buzzer-Fragen wertest du mit Richtig (R) oder Falsch (F).',
      'Bei Fragen für alle schließt du die Antworten. Eintipp-Antworten prüfst du danach selbst, alles andere wertet sich automatisch.'],
    ordnung: ['Es braucht mindestens zwei Spieler oder Teams. Teams bildest du unter den Punkten.',
      'Hängt jemand fest, kannst du seinen Zug überspringen.'],
    zuordnen: ['Es braucht mindestens zwei Spieler oder Teams. Teams bildest du unter den Punkten.',
      'Hängt jemand fest, kannst du seinen Zug überspringen.'],
  }[mode] ?? [];
  return section('Für dich als Host', items,
    'Punkte, Antwortzeit und erneutes Buzzern stellst du unter den Punkten ein. Diese Regeln passen sich sofort an.',
    'Mit + und − neben den Namen korrigierst du jederzeit Punkte.');
}

// Alle Bausteine einer Regelübersicht.
export function rulesContent(mode, settings, { host = false } = {}) {
  return [
    ...modeRules(mode, settings),
    section('Allgemein',
      'Geredet wird in Discord, gespielt wird auf dieser Seite. Rechts bzw. unten siehst du immer den Punktestand.',
      'Im Zweifel entscheidet der Host.',
      'Verbindung weg? Seite einfach neu laden, du bist dann wieder mit deinen Punkten drin.'),
    host ? hostRules(mode) : null,
  ].filter(Boolean);
}

// Fenster mit den Regeln, zu öffnen über den Knopf in der Kopfzeile.
export class RulesDialog {
  constructor({ host = false } = {}) {
    this.host = host;
    this.info = null;
    this.title = h('h2', {}, 'Regeln');
    this.body = h('div', { class: 'regeltext' });
    this.dialog = h('dialog', { class: 'regelfenster', 'aria-label': 'Regeln' },
      h('div', { class: 'regelkopf' }, this.title,
        h('button', { class: 'knopf klein', type: 'button', onclick: () => this.dialog.close() }, 'Schließen')),
      this.body);
    // Klick neben das Fenster schließt es.
    this.dialog.addEventListener('click', (e) => { if (e.target === this.dialog) this.dialog.close(); });
    document.body.append(this.dialog);
    this.button = document.getElementById('regelknopf');
    this.button?.addEventListener('click', () => this.open());
  }
  get isOpen() { return this.dialog.open; }
  update(mode, settings) {
    const key = JSON.stringify([mode, settings]);
    if (this.button) this.button.hidden = !mode;
    if (!mode || key === this.info) return;
    this.info = key;
    this.title.textContent = `Regeln: ${MODE_NAMES[mode] ?? mode}`;
    this.body.replaceChildren(...rulesContent(mode, settings, { host: this.host }));
  }
  open() {
    if (!this.info || this.dialog.open) return;
    this.dialog.showModal();
    this.body.scrollTop = 0;
  }
}
