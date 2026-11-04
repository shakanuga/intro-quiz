# Intro-Quiz

Ein Quiz mit Buzzer im Browser und mehreren Spielmodi, gemacht für Runden über Discord oder andere Sprachchats. Niemand muss etwas installieren oder einen Bildschirm teilen: Der Ton läuft direkt im Browser jedes Spielers und startet überall gleichzeitig.

## So läuft ein Spiel

1. Der Host öffnet `/host`, lädt Intros hoch und gibt den Spielcode weiter.
2. Die Spieler öffnen `/` und treten mit Name und Code bei.
3. Der Host spielt ein Intro ab. Während es läuft, sind die Buzzer offen.
4. Wer buzzert, stoppt den Ton bei allen und antwortet im Sprachchat.
5. Der Host wertet mit „Richtig“ oder „Falsch“. Bei „Richtig“ wird die Lösung aufgedeckt, bei „Falsch“ läuft das Intro weiter.

Die Spieler buzzern per Knopf oder Leertaste. Der Host steuert auch per Tastatur: Leertaste für Abspielen und Pause, `R` für richtig, `F` für falsch und `N` für die nächste Runde.

## Fragetypen

Die Fragetypen gehören zu vier Spielmodi. Inhalte und gespeicherte Quizze sind je Modus getrennt, innerhalb von „50 Fragen“ lassen sich die fünf ersten Typen mischen.

| Spielmodus | Inhalt |
| --- | --- |
| Intro-Quiz | hochgeladene Intros |
| 50 Fragen | Buzzer, Eintippen, Auswahl, Schätzen und Sortieren |
| Ordnungshüter | Listen zum Einordnen |
| Zuordnen | Paare mit Ködern |

Den Modus wählst du im Host-Bereich vor dem Spielstart, auch für ein weiteres Spiel mit denselben Spielern.

| Typ | Ablauf | Wertung |
| --- | --- | --- |
| Buzzer | Wer zuerst buzzert, antwortet im Sprachchat. | Host |
| Eintippen | Alle tippen eine Antwort. Exakte Treffer sind vorgeschlagen. | Host, auch mit Teilpunkten |
| Auswahl | Alle wählen eine von bis zu 8 Optionen. | automatisch |
| Schätzen | Alle geben eine Zahl ein. Die nächste gewinnt, bei Gleichstand alle Nächsten. | automatisch |
| Sortieren | Alle bringen gemischte Einträge in die richtige Reihenfolge. | automatisch, nur exakt richtig zählt |
| Ordnungshüter | Teams oder Einzelne ordnen abwechselnd Einträge in eine wachsende Liste ein. | automatisch |
| Zuordnen | Teams oder Einzelne bilden Paare, bis ein Paar falsch ist. | automatisch |

Fragen legst du im Host-Bereich einzeln an oder importierst sie als CSV. Aus jeder Datei wird ein gespeichertes Quiz mit dem Dateinamen, und jeder Inhalt landet im passenden Modus. Eine Vorlage gibt es unter `/vorlage.csv` und im Host-Bereich.

| Spalte | Inhalt |
| --- | --- |
| `typ` | Buzzer, Eintippen, Auswahl, Schätzen, Sortieren, Ordnungshüter oder Zuordnen |
| `frage` | die Frage |
| `optionen` | getrennt mit `\|`. Bei Sortieren und Ordnungshüter in der richtigen Reihenfolge. Ordnungshüter: `Eintrag=Wert`. Zuordnen: `Begriff=Gegenstück`, Köder als `=Köder`. |
| `loesung` | die Lösung. Bei Auswahl der Text oder Buchstabe, bei Schätzen eine Zahl, bei Sortieren leer. |
| `erklaerung` | erscheint freiwillig bei der Auflösung |
| `punkte` | leer bedeutet der Standardwert |

### Ordnungshüter

Eine Liste enthält meist neun Einträge, die richtige Reihenfolge steht in der CSV-Datei. Ein zufälliger Eintrag liegt mit seinem Wert aus. Danach wählt, wer dran ist, einen Eintrag und seinen Platz in der Liste. Die App prüft den Zug selbst.

- Ein Fehler ist frei, der falsche Eintrag landet an der richtigen Stelle. Beim zweiten Fehler scheidet man aus.
- Teams legst du in der Punkteliste fest oder lost sie aus. Ohne Teams spielt jeder einzeln.
- Im Teamspiel gewinnt, wer zuletzt übrig ist oder am Ende weniger Fehler hat, und nur der Sieger punktet. Bei Gleichstand gibt es keine Punkte.
- Einzeln bekommt Platz 1 die vollen Punkte, jeder weitere Platz einen weniger. Mit 3 Punkten ergibt das 3, 2, 1.

### Zuordnen

Links stehen Begriffe, rechts ihre gemischten Gegenstücke, dazu auf Wunsch Köder ohne Partner. Wer dran ist, bildet so lange Paare, bis eins falsch ist. Das falsche Paar wird nicht aufgelöst, und die nächste Partei ist dran. Jedes richtige Paar gibt sofort einen Punkt, ein Wert in `punkte` ersetzt diesen Standard. Im Teamspiel bekommt jedes Mitglied die Punkte.

Beide Modi sind Formaten von PietSmiet nachempfunden. Dieses Projekt steht in keiner Verbindung zu PietSmiet.

## Quizze und Statistik

Im Bereich „Inhalte“ findest du die Quizze des gewählten Modus. In den Fragenmodi öffnest du ein Quiz, um seine Einträge in ihrer Reihenfolge zu sehen und zu bearbeiten. Löschst du ein Quiz, verschwinden seine Einträge mit. Im Intro-Quiz liegen alle Intros in einer Sammlung. Du wählst aus, was ins aktuelle Quiz kommt, und speicherst die Auswahl mit Reihenfolge unter einem Namen. Gespeicherte Quizze lädst du vor dem Spielstart. An jedem Intro steht, wie oft es schon gespielt wurde.

Der Bereich „Statistik“ ist nur für den Host sichtbar. Er zeigt Siege, Punkte, richtige und falsche Antworten und die schnellste Antwort je Spieler, dazu jede Serie und jedes vergangene Spiel mit allen Runden. Spieler werden über ihren Namen wiedererkannt, sie sollten also immer denselben verwenden.

Mit „Nochmal mit denselben Spielern“ bleiben alle im Spiel, die Punkte starten wieder bei null.

## Einstellungen im Host-Bereich

| Einstellung | Standard | Bedeutung |
| --- | --- | --- |
| Richtig | 3 | Punkte für eine richtige Antwort |
| Falsch | -1 | Punkte für eine falsche Antwort |
| Antwortzeit | 0 (aus) | Zeigt nach dem Buzzern und bei Eingabefragen allen einen Countdown. Der Host schließt die Runde selbst. |
| Nach falscher Antwort erneut buzzern | aus | Aus: Wer falsch liegt, ist für diese Runde gesperrt. An: Alle dürfen weiter buzzern. |

## Starten mit Docker

```bash
docker run -d --name intro-quiz \
  -p 3000:3000 \
  -e HOST_PASSWORD='ein-langes-passwort' \
  -v intro-quiz-data:/data \
  ghcr.io/shakanuga/intro-quiz:latest
```

Danach läuft das Quiz unter `http://localhost:3000`, der Host-Bereich unter `/host`.

Oder mit Docker Compose:

```yaml
services:
  intro-quiz:
    image: ghcr.io/shakanuga/intro-quiz:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      HOST_PASSWORD: ein-langes-passwort
    volumes:
      - intro-quiz-data:/data

volumes:
  intro-quiz-data:
```

## Einstellungen des Containers

| Variable | Pflicht | Standard | Bedeutung |
| --- | --- | --- | --- |
| `HOST_PASSWORD` | ja | | Passwort für den Host-Bereich, mindestens 8 Zeichen |
| `PORT` | nein | `3000` | Port im Container |
| `DATA_DIR` | nein | `/data` | Ordner für Intros und Spielstand |

## Online stellen

Deine Mitspieler müssen den Server aus dem Internet erreichen. Das geht zum Beispiel über einen Reverse Proxy oder einen Cloudflare Tunnel, dann musst du keine Ports öffnen. Wichtig sind drei Dinge:

- Die Seite läuft über HTTPS.
- WebSockets sind erlaubt, sonst funktioniert der Buzzer nicht.
- Der Proxy gibt den ursprünglichen `Host`-Header weiter, sonst lehnt der Server die WebSocket-Verbindung ab.

Mitspielen geht nur mit dem Spielcode, die Steuerung ist durch das Host-Passwort geschützt. Jede Installation hostet genau ein Spiel gleichzeitig.

## Intros

Der Dateiname wird zur Lösung, aus `Die Simpsons.mp3` wird also „Die Simpsons“. Erlaubt sind MP3, M4A, OGG, OPUS, WAV und FLAC mit bis zu 40 MB. MP3 mit 128 kbit/s reicht aus. Dieses Repo enthält keine Intros. Achte bei eigenen Dateien auf die Rechte, besonders wenn deine Instanz öffentlich erreichbar ist.

## Entwickeln

```bash
npm install
HOST_PASSWORD=testtest1 DATA_DIR=./data node server.js
npm test
```

## Lizenz

Der Code steht unter der MIT-Lizenz, siehe `LICENSE`. Die Schriftart Pixelify Sans steht unter der SIL Open Font License, siehe `public/fonts/PixelifySans-OFL.txt`.
