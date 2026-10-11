# Hosting the relics server for friends: what the server needs, and the options

**Question answered:** what does the server really need (ports, memory, disk, state), what is unsafe about exposing it as configured, and which hosting routes fit a "cheap or free" goal?

**Based on commits:** first part root `ebe235c`, Engine-TS `04db3dc2`, Content `34a8a0397`, Client-TS `2ea4280`; "Chosen setup" part Engine-TS `53ed3a49`, Content `9a5b2466a`, Client-TS `cd03818`.

**Method:** read the code, and **ran** the server once on a 4-core, 16 GB Linux container (Node 24.11.1, `config/world.json` from this repo, `mods/` synced, cold cache pack). Nothing was created in any cloud and no one connected as a player. Prices and free-tier terms in the options table are **not verified** (nothing was fetched).

## Findings: what the server needs

1. **Browser players need one port only.** The client opens its WebSocket to `window.location.host`, using `wss` when the page is `https` (`Client-TS/src/client/Client.ts:1737`), and the engine accepts that WebSocket on the web server's `/` route (`Engine-TS/src/web.ts:82-100`). The page itself is `/rs2.cgi` (`web.ts:138`). Default web port is 8888 on Linux, 80 on Windows/macOS (`Engine-TS/src/util/WorldConfig.ts:87`). So friends only need the web port, which also works behind an HTTPS reverse proxy or tunnel that passes WebSockets.
2. **The game TCP port (43594) is not needed for browser play.** It is for non-browser clients; the server listens on `0.0.0.0` (`Engine-TS/src/server/tcp/TcpServer.ts:70`). Do not open it unless wanted. (Inference: no browser path uses it; not tested with a Java client.)
3. **The management port (8898) must never be public.** It listens on `0.0.0.0` (`web.ts:348`) and serves `/setup`, `PUT /setup/config` (rewrites `world.json`, `web.ts:337-345`) and `/prometheus`. None of these routes checks credentials (no auth code in `web.ts:320-345`). Firewall it or bind via the host firewall.
4. **No password is checked with the default config.** With the login service disabled (default), `LoginThread` only looks for `data/players/<profile>/<username>.sav`: if the file exists the player gets that save, whatever password they typed (`Engine-TS/src/server/login/LoginThread.ts:63-100`). So any friend (or stranger with the URL) can log in as any existing username. Enabling the login service (`login.enabled` / `easyStartup`, `LoginServer.ts:142`) uses bcrypt accounts (`LoginServer.ts:227`). Not run, so how well it works with the relic mods is **not verified**.
5. **Everyone is a developer by default.** With `node.production = false` (default, `WorldConfig.ts:101`) the login thread gives every player `staffmodlevel = 4` (`LoginThread.ts:63-67`), and the cheat handler then allows developer commands (`ClientCheatHandler.ts:57`). On a shared server set `"node": { "production": true }`. Side effect (inference from `ClientCheatHandler.ts:57` and `docs/flows/dev-cheat-commands.md`): `::~relic_*` debug procs and dev cheats stop working for you too.
6. **Player data is files on disk**: `Engine-TS/data/players/<profile>/<name>.sav` (`LoginThread.ts:121,142`). Any host must keep `Engine-TS/data/players` on persistent storage and back it up. Whether a crash loses recent progress was not checked (autosave exists, see `docs/tick/11-cleanup-and-tail.md` rule 15).
7. **Measured resources (idle, 0 players, relic mods loaded):** about **750 MB resident** and about **5% of one core** (`top`: RES 748960 KB, 5.6% CPU) after startup. Startup after the first pack took about 13 s (`Packing...` to `World ready`); the first cold pack of the cache took a couple of minutes on 4 cores. Disk: `Engine-TS/data` 39 MB after packing, `Content` 105 MB, `Engine-TS/node_modules` 402 MB. **Not measured:** memory and CPU with real players online (it is a single main thread, so a core's speed matters more than core count; inference from the process list, not profiled).
8. **Runtime needs:** Node >= 24 (`Engine-TS/package.json` engines; Node 22.22 failed with `ERR_INVALID_MODULE_SPECIFIER` on `#/server/login/LoginClient.js` when I tried it), plus Bun to build the client (`mise.toml` `client:build`; the relic client changes only reach the browser after that build, see `docs/setup/settings.md` troubleshooting). A 1 GB machine is too small for 750 MB resident plus OS plus players; **2 GB is the practical floor**, 4 GB comfortable (inference from the measurement above).

## Options

| Option | Cost | Fit | Caveats |
|---|---|---|---|
| **A. Keep running on your PC, share through a tunnel** (Cloudflare Tunnel or Tailscale Funnel to port 8888) | Free (not verified) | Easiest. No port forwarding, gives friends an `https` link, WebSocket works through it (finding 1). | Only up while your PC is on. Tunnel terms not verified. |
| **B. Keep running on your PC, forward port 8888 on your router** | Free | Simple but exposes your home IP. | Needs router access; ISP may use CGNAT. Use `production: true`. |
| **C. Oracle Cloud "Always Free" Arm VM** (up to 4 cores / 24 GB per their published terms, not verified) | Free, if capacity is available | Best free fit for 2-4 GB. | Capacity is often unavailable; idle-instance reclaim and signup card checks. Arm Node 24 not tried. |
| **D. Small VPS (Hetzner, DigitalOcean, etc., about 2 GB)** | A few USD/EUR a month (not verified) | Most reliable cheap route; always on. | Not free. |
| **E. AWS free tier / credits** | Current free plan terms not verified | Works technically on a 2 GB instance (t3.small class); a 1 GB `t3.micro` is too small (finding 8). | Likely to leave the free allowance, bills if forgotten. |

**CI/CD for C, D or E** (nothing built yet): a GitHub Actions workflow on push to `main` that SSHes to the VM and runs `git pull`, `git submodule update --init`, `mise run client:build`, `mise run mods:sync`, then restarts a systemd service. Needs a deploy key as a repo secret, `data/players` kept outside the checkout or backed up, and a restart that waits for the server's graceful save (`SIGTERM` calls `World.rebootTimer(0)`, `Engine-TS/src/app.ts` `safeExit`). Submodule forks must be fetchable by the VM.

## Open questions

- Memory and tick time with several real players online (not measured).
- Does enabling the login service (bcrypt accounts, `easyStartup`) work cleanly with this repo's mods and relic saves?
- Whether the Oracle Arm VM and Node 24 / `tsx` work together, and current Oracle and AWS free-tier terms.

## Chosen setup (Calum, 2026-10-11): host on your PC, public https link, shared access code, `::map` working

### Access code (built, tested)

- World setting `node.accessCode` (default `''` = off), Engine-TS `53ed3a49`: `Engine-TS/src/util/AccessCode.ts` (`accessCodeAllows`, constant-time compare), checked in the login handler right after the password length check (`Engine-TS/src/engine/World.ts`, search `accessCodeAllows`), before anything is sent to the login thread. A wrong code gets reply 3, the same "Invalid username or password" a bad password gets.
- **Friends type the code in the Password box.** The login screen has no other field. Limit: 1-20 characters, because the engine rejects longer passwords (`World.ts` password length check).
- Tests: `tests/access-code.test.ts` (3). Failed first because the module did not exist, passes after. Full suite 344 passing, `test:types` clean (Node 24.11.1).
- Observed in headless Chromium: password `wrong` showed "Invalid username or password"; the right code logged in. The login screen text was read from a screenshot.
- **Limit (by design):** the code is one shared password, so anyone with the code can log in as any friend's username (there are still no per-player passwords). Fine for friends, not for strangers. Brute force: `node.rateLimitDeviceLogin` (5 per 15 s per device+address, production mode only, `World.ts` login handler) slows it; use a long random code.
- Write the config with `ACCESS_CODE=your-code mise run public:config` (`scripts/public-config.mjs`): relic settings from `config/world.json` plus `production: true` (no dev commands), `debug: false` (no `/maped` map editor: `/maped` returned 404 when run), and the code. It overwrites `Engine-TS/data/config/world.json`. Restart the server afterwards.

### `::map` for friends

- `::map` runs `window.open('/worldmap.html', ...)` (`Client-TS/src/client/Client.ts`, `openWorldMap`): a **relative** URL, so on an https site it opens on that same site. The page loads `/worldmap.jag` by relative URL, and the player marker travels over a `BroadcastChannel` (same origin only). Nothing in `Client-TS/src/mapview/` or `Client.ts` hard-codes `localhost` for the map (grep).
- `/worldmap.jag` is served even with `debug: false` (`Engine-TS/src/web.ts`, route comment "also served outside debug mode").
- **Run:** server with `production: true`, `debug: false`, code on; client built from Client-TS `cd03818`; logged in through `http://127.0.0.1:8888` and typed `::map`: a popup opened at `http://127.0.0.1:8888/worldmap.html` and drew the world map with the red "you" marker on Tutorial Island (screenshot). One resource returned 404 (not identified, probably the favicon). **Not run:** over https or through a tunnel, and not with a second window of another browser.
- Popups: a browser may block `window.open` unless it comes from a user action; the `::map` Enter key press worked in Chromium. Other browsers' popup blockers are **not checked**.

### Public https link (not built or run: no tunnel was available here)

- The browser client opens its WebSocket to the page's own host and uses `wss` on https (`Client-TS/src/client/Client.ts`, `openSocket(window.location.host, window.location.protocol === 'https:')`), so a tunnel that forwards HTTP and WebSockets to port 8888 is enough.
- Suggested: Cloudflare Tunnel (`cloudflared tunnel --url http://localhost:8888` gives a random `https://...trycloudflare.com` link without an account, new each run; a stable name needs a domain on Cloudflare). **Not verified** here: tool terms, WebSocket support through quick tunnels, and the link surviving restarts.
- Behind a tunnel every player appears from `127.0.0.1` to the engine (inference: the tunnel connects from your machine). The engine uses the address for the per-tick processing order bucket (open question 23) and the device-login rate limit key (`uid@address`, per client uid, so friends are still separate).
- Keep 8898 (management) and 43594 off the internet: do not forward them, and the tunnel only exposes 8888.

### Day-to-day (unverified as a whole; each step above was run separately)

1. `git pull && git submodule sync --recursive && git submodule update --init`, `mise run client:build`, `mise run mods:sync`.
2. `ACCESS_CODE=<code> mise run public:config`.
3. `mise run start` (do not use `live` for a public server: it watches mods).
4. `cloudflared tunnel --url http://localhost:8888`, share the https link and the code. Friends: open the link, Existing User, any username, **password = the code**.

### `mise run host` (2026-10-11): one command for the day-to-day steps above

`scripts/host-public.mjs`, task `host` in `mise.toml`. Asks for the access code (or reads `ACCESS_CODE`), runs `scripts/public-config.mjs` (which now also pins `web.port` to 8888 on every OS), starts `mise run start`, waits for `http://localhost:8888/rs2.cgi`, starts `cloudflared tunnel --url http://localhost:8888`, reads the `https://...trycloudflare.com` link from its output and prints it with the code. Ctrl+C stops the tunnel and the server (SIGINT, so the engine can save).

- **Ports:** only the web port 8888 is tunnelled (it carries the page, the WebSocket and `::map`). 43594 and 8898 are not exposed by the tunnel. Both still listen on `0.0.0.0` on your machine (`web.ts`, `TcpServer.ts`), so they are reachable from your own network (LAN), but not from the internet unless you forward them on the router.
- **Cloudflare login:** the free quick tunnel needs **no Cloudflare account and no login**. A login is only needed for a stable link on your own domain: `CF_TUNNEL_HOSTNAME=game.example.com mise run host` runs `cloudflared tunnel login` (browser) if `~/.cloudflared/cert.pem` is missing, then creates tunnel `lostcity-relics`, points the hostname at it and runs it. **That named-tunnel branch was not run** (needs an account and domain).
- **cloudflared dependency:** `cloudflared = "latest"` is in `[tools]` of `mise.toml` (mise's registry maps it to `aqua:cloudflare/cloudflared`, read from `mise registry`, mise 2026.10.6). **Not verified:** `mise install cloudflared` itself (blocked in the cloud container); the script falls back to a `cloudflared` on PATH and prints install hints if none is found. Run `mise run up` once first so dependencies and the client exist.
- **Tested here:** with a fake `mise` and a fake `cloudflared` (prints a `trycloudflare.com` line): the code prompt, the written `world.json` (`production`, `debug: false`, `accessCode`, `web.port 8888`), the real server starting and answering, and the link banner. **Not tested:** a real quick tunnel (the container cannot reach `api.trycloudflare.com`: DNS lookup failed), the Windows path (`taskkill`, `shell: true`), and the Ctrl+C save.
