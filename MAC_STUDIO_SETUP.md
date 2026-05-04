# Mac Studio setup

De Mac Studio is de show-machine. Alles draait daar lokaal: server, admin, stage output, SQLite data en de QR/join-flow. De MacBook is alleen tijdelijk een ontwikkelmachine die naar GitHub pusht.

## Eenmalige installatie op de Mac Studio

Open Terminal op de Mac Studio en run:

```bash
/bin/zsh -lc 'mkdir -p "$HOME/ForYou" && cd "$HOME/ForYou" && if [ ! -d App/.git ]; then git clone https://github.com/booikluiving/foryouapp.git App; fi && cd App && ./scripts/mac-studio-setup.command'
```

Als GitHub om toegang vraagt: log in met je GitHub-account of configureer eerst GitHub Desktop/`gh auth login`.

Het setup-script doet:

- checkt Node 22+ en gebruikt Homebrew als Node nog ontbreekt
- haalt `main` op uit GitHub
- installeert `npm` dependencies
- installeert een macOS LaunchAgent
- start de app automatisch op poort `3310`
- draait een smoke-test
- print lokale en netwerk-URL's

Bij een verse database is het tijdelijke admin-wachtwoord:

```text
Tijdelijk_2026!
```

## Dagelijks updaten op de Mac Studio

Na een push vanaf je MacBook run je op de Mac Studio:

```bash
cd "$HOME/ForYou/App"
./scripts/mac-studio-update.command
```

Dat doet:

- `git pull --ff-only`
- `npm install`
- service restart
- smoke-test

## Status checken op de Mac Studio

```bash
cd "$HOME/ForYou/App"
./scripts/mac-studio-status.command
```

Deze check toont launchd-status, health, URLs, git status en de laatste serverlogregels.

## Admin met meerdere mensen

Meerdere mensen kunnen tegelijk naar:

```text
http://<mac-studio-ip>:3310/admin
```

Iedere browser krijgt een eigen admin-token. De adminpagina ververst state automatisch. Als twee mensen tegelijk dezelfde instelling wijzigen, wint de laatste actie.

Voor de show zelf is lokaal op de Mac Studio het meest stabiel:

```text
http://127.0.0.1:3310/admin
http://127.0.0.1:3310/stage
```

Publiek gebruikt de LAN-link/QR met het Mac Studio IP.

## Git workflow

Op je MacBook:

```bash
git add .
git commit -m "..."
git push origin main
```

Op de Mac Studio:

```bash
cd "$HOME/ForYou/App"
./scripts/mac-studio-update.command
```

De showdata in `data/live.sqlite` wordt niet gepusht. Die blijft lokaal op de Mac Studio.
