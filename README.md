# Intro-Quiz

Ein Ratequiz für Serien-Intros mit Buzzer im Browser, gemacht für Runden über Discord oder andere Sprachchats. Niemand muss etwas installieren oder einen Bildschirm teilen: Der Ton läuft direkt im Browser jedes Spielers und startet überall gleichzeitig.

## So läuft ein Spiel

1. Der Host öffnet `/host`, lädt Intros hoch und gibt den Spielcode weiter.
2. Die Spieler öffnen `/` und treten mit Name und Code bei.
3. Der Host spielt ein Intro ab. Während es läuft, sind die Buzzer offen.
4. Wer buzzert, stoppt den Ton bei allen und antwortet im Sprachchat.
5. Der Host wertet mit „Richtig“ oder „Falsch“. Bei „Richtig“ wird die Lösung aufgedeckt, bei „Falsch“ läuft das Intro weiter.

Die Spieler buzzern per Knopf oder Leertaste. Der Host steuert auch per Tastatur: Leertaste für Abspielen und Pause, `R` für richtig, `F` für falsch und `N` für die nächste Runde.

## Einstellungen im Host-Bereich

| Einstellung | Standard | Bedeutung |
| --- | --- | --- |
| Richtig | 3 | Punkte für eine richtige Antwort |
| Falsch | -1 | Punkte für eine falsche Antwort |
| Antwortzeit | 0 (aus) | Zeigt nach dem Buzzern allen einen Countdown. Gewertet wird weiter vom Host. |
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
