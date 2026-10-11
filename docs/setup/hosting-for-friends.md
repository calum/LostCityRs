# Hosting the relics server for friends: what the server needs, and the options

**Question answered:** what does the server really need (ports, memory, disk, state), what is unsafe about exposing it as configured, and which hosting routes fit a "cheap or free" goal?

**Based on commits:** root `ebe235c`, Engine-TS `04db3dc2`, Content `34a8a0397`, Client-TS `2ea4280` (fork `main` heads).

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
