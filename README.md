# BluOS Web UI

English | [日本語](README_ja.md)

A web UI for controlling BluOS players (Bluesound and others).

> **Note:** The user interface, CLI output and messages are currently in Japanese only.

## Run with Docker Compose

```sh
cp .env.example .env    # set BLUOS_HOST to your player's address
docker compose up -d --build
# → http://<address of this machine>:3000
```

| `.env` variable | Default      | Description                                  |
| --------------- | ------------ | -------------------------------------------- |
| `BLUOS_HOST`    | (required)   | Player to control (`host:port`)              |
| `WEB_PORT`      | `3000`       | Host port the web UI is published on         |

- `BLUOS_HOST` is required. Without it, `docker compose up` fails with an error
- Stop with `docker compose down`; rebuild after updating with `docker compose up -d --build`
- The container uses `restart: unless-stopped`, so it starts again automatically after the machine reboots
- The container must be able to reach the player (`BLUOS_HOST` on your LAN) over HTTP (the default bridge network is fine)

### Finding the player's IP address

You can find the address for `BLUOS_HOST` on the Diagnostics screen of the official BluOS Controller app. The port is `11000`, so specify `<IP address>:11000`.

- **iOS / Android**: Select the player in the Players tab, then go to the Home tab → Settings → Help & Support → Diagnostics
- **Windows / macOS**: In the left navigation drawer, select Help → Diagnostics

The Diagnostics screen also lists the IP addresses of the other players on the same network. Menu names may differ slightly between app versions (see the [official support article](https://support.bluos.net/hc/en-us/articles/360000463947-How-do-I-find-the-IP-Address-of-my-Player)).
The UI cannot connect if the player's IP address changes, so it is a good idea to reserve a fixed address for the player in your router's DHCP settings.

If `curl http://<IP address>:11000/SyncStatus` returns XML with the player's name and other details, the address is correct.

## Install as an app

In Chrome, Edge and similar browsers, you can add the UI to the taskbar or home screen and open it in its own window (PWA).

- Chrome: the install button at the right end of the address bar, or "⋮ → Cast, save, and share → Install page as app"
- Edge: "… → Apps → Install this site as an app"
- Safari on iPhone / iPad: Share → "Add to Home Screen"

Browsers allow a proper installation only over HTTPS or `localhost`.
With `http://<LAN address>:3000`, the install button may not appear, or some browsers add it only as a shortcut that opens in a window.
To install it properly, serve it over HTTPS through a reverse proxy.

## Run for development

```sh
mise install        # Node.js 26
npm install
BLUOS_HOST=<player address>:11000 npm start   # http://localhost:3000
```

| Environment variable | Default    | Description                   |
| -------------------- | ---------- | ----------------------------- |
| `BLUOS_HOST`         | (required) | Player `host:port`            |
| `PORT`               | `3000`     | Port the web UI listens on    |
| `LISTEN`             | `0.0.0.0`  | Address the web UI listens on |

## CLI

The `bluos` command connects to the player directly. It works without the web server running.

```sh
npm link                       # install the bluos command (or use node bin/bluos.js inside the project)
export BLUOS_HOST=<player address>:11000   # or pass --host
bluos                          # playback status
bluos pause / bluos play / bluos next
bluos volume 30 / bluos volume +5 / bluos volume -5
bluos play-playlist Favorites --mode shuffle
bluos search queen             # search (choose a service with --service Amazon etc.)
bluos --json queue             # JSON output
bluos --help                   # all commands
```

If you run it with Docker, you can also use it inside the container, e.g. `docker compose exec bluos-web bluos status`.

## Agent Skill

`.claude/skills/bluos/` is an Agent Skill that teaches AI agents (such as Claude Code) how to use the CLI.
Ask things like "What's playing now?", "Turn the volume down" or "Play ...", and the agent operates the player with the `bluos` command.

- It is loaded automatically when you use Claude Code inside this repository
- To use it elsewhere, link it as a user skill:
  `ln -s <this repository>/.claude/skills/bluos ~/.claude/skills/bluos`
- Pass the player's address in the `BLUOS_HOST` environment variable (if it is missing, the agent asks for it)
- The skill's `scripts/bluos` calls the repository's `bin/bluos.js`, so run `npm install` first

Like the MCP server, it covers only reading the status and controlling playback.

## MCP server

AI agents (Claude Code, Claude Desktop, etc.) can check the playback status and control playback.
It covers reading the status and controlling playback only (play, pause, next, volume, seek, shuffle, repeat, playing searched tracks or playlists, adding to the queue).
It cannot clear the queue or change playlists, presets or alarms.

stdio (started locally):

```sh
claude mcp add bluos --env BLUOS_HOST=<player address>:11000 -- node <this repository>/bin/bluos.js mcp
```

HTTP (`/mcp` on the running web server, e.g. when running with Docker):

```sh
claude mcp add --transport http bluos http://<web server address>:3000/mcp
```

Like the web UI, `/mcp` has no authentication, so anyone on your LAN can control the player (the same scope as the web UI).
To prevent it from being called through a browser by pages on other sites, requests with an `Origin` header are accepted only from the same host.

## Tests

```sh
npx playwright install chromium   # first time only (browser for E2E)
npm test                          # unit tests → E2E tests
npm run test:unit                 # unit tests for server.js and lib/ (node:test)
npm run test:e2e                  # E2E tests in the browser (Playwright)
```

- Unit tests run against a fake player and E2E tests mock every API in the browser, so no real player is needed (nothing is sent to a real player)
- Coverage must be at least 95% for both unit tests (`server.js`, `lib/`) and E2E tests (`public/app.js`); otherwise the tests fail.
  The E2E report is in `coverage/e2e/`. To run only some specs, turn off the threshold check, e.g. `COVERAGE_CHECK=0 npx playwright test e2e/queue.spec.js`

## Structure

- `Dockerfile` / `compose.yaml` — image based on `node:26-alpine` (runs as non-root, with a health check)
- `server.js` — serves static files and relays the BluOS API. Forwards `/api/d/<BluOS path>` to the player and converts XML responses to JSON (images are passed through). Relayed APIs are limited by `ALLOWED`. Also provides the MCP server (HTTP) at `/mcp`.
- `lib/` — communication with the player (`player.js`), operations shared by the CLI and MCP (`actions.js`), MCP tool definitions (`mcp.js`), the CLI (`cli.js`)
- `bin/bluos.js` — CLI entry point (`bluos mcp` starts the stdio MCP server)
- `.claude/skills/bluos/` — Agent Skill that uses the CLI (`SKILL.md` and `scripts/bluos`, which calls the CLI)
- `test/` — unit tests for `server.js` and `lib/` (`fake-player.js` is the fake player); `e2e/` — E2E tests (`mock-player.js` mocks the API)
- `public/` — front end (plain HTML/CSS/JS, no build step)
  - Full-screen now-playing view (⛶ or click the artwork; open directly with `/#nowplaying`)
  - Now playing, play/pause/previous/next/seek/volume/mute/shuffle/repeat, favourites
  - Track menu (now playing, queue, browse, folders): favourites, add to playlist, go to album/artist, track info, technical info
  - Queue (select, remove, clear, drag to reorder, save as a playlist)
  - Playlists (list, show tracks, play/shuffle/play next/add last, delete)
  - Favourites (library tracks, albums, artists and playlists; TuneIn stations)
  - Presets and input switching (add, reorder, rename and delete presets)
  - Sleep timer, alarms
  - Browse (library, Amazon Music, radio, etc.; search; context menus; the library's New, folder view and rescan)

The playback status is tracked with long polling on `/Status?timeout=90&etag=...`.

## License

[MIT License](LICENSE)
