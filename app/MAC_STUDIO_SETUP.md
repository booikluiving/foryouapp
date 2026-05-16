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
- haalt `main` op uit GitHub voor de live showserver
- installeert `npm` dependencies
- installeert een macOS LaunchAgent
- start de app automatisch op poort `3310`
- draait een smoke-test
- print lokale en netwerk-URL's

Admin-auth staat standaard uit voor het besloten technici-netwerk. Zet `ADMIN_AUTH_DISABLED=0` om wachtwoordlogin later weer te activeren.
Peer-sync blijft apart beveiligd: als sync gebruikt wordt, moet `FORYOU_SYNC_SECRET` of `SYNC_SECRET` expliciet in de environment staan.

## Dagelijks updaten op de Mac Studio

Na een push vanaf je MacBook run je op de Mac Studio:

```bash
cd "$HOME/ForYou/main/app"
./scripts/mac-studio-update.command
```

Dat doet:

- `git pull --ff-only`
- `npm install`
- service restart
- smoke-test

`mac-studio-update.command` is bewust de live-update voor `main` op poort `3310`. Werk je op een branch, gebruik dan een preview in plaats van de live service te verplaatsen.

## Branch-preview op de Mac Studio

Branches mogen vrij gebruikt worden voor ontwikkeling en review. Start ze op een aparte poort:

```bash
cd "$HOME/ForYou/main/app"
./scripts/mac-studio-preview.command codex/mijn-branch
```

Default:

- branch-worktree: `$HOME/ForYou/worktrees/<branch>`
- previewpoort: `3311`
- live showserver: blijft `main` op `3310`

Andere previewpoort:

```bash
FORYOU_PREVIEW_PORT=3312 ./scripts/mac-studio-preview.command codex/mijn-branch
```

Preview stoppen:

```bash
./scripts/mac-studio-preview.command stop codex/mijn-branch
```

Pas na review merge je de branch naar `main` en run je weer `./scripts/mac-studio-update.command` voor de live showserver.

## Status checken op de Mac Studio

```bash
cd "$HOME/ForYou/main/app"
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

Voor gewoon ontwikkelen mag je lokaal of op de Mac Studio een branch gebruiken:

```bash
git switch -c codex/mijn-branch
git add .
git commit -m "..."
```

Voor live deploy blijft de route:

```bash
git add .
git commit -m "..."
git push origin main
```

Op de Mac Studio:

```bash
cd "$HOME/ForYou/main/app"
./scripts/mac-studio-update.command
```

De showdata in `data/live.sqlite` wordt niet gepusht. Die blijft lokaal op de Mac Studio.
