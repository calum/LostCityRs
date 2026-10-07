# How the LostCityRS project started and how the server was recreated

**Question answered:** Who/what is Lost City, when did it start, and how was a server recreated when the client cache holds no server logic?

**Based on commits:**
- Engine-TS: `1d25566c` (read via git history and README; detached HEAD, not yet on `calum-research`)
- Content: `65b754f76`
- Client-TS: `7d6ca61`
- RuneScriptTS: `c454554`
- Server: `0b6a0cb`

**Method:** read submodule `git log` / READMEs, plus a forum FAQ **pasted by the user** (source: "FAQ: What is Lost City?", lostcity.rs/t/faq-what-is-lost-city/16, author Pazaz, dated 21 Dec 2024 but describing events up to Jan 2026, so edited later; last-edit date unknown). Nothing was run. The forum could not be fetched from this environment (HTTP 403), so FAQ claims are **unverified against the live page**; where git corroborates, it is noted.

## Findings

### From the FAQ (user-pasted, not independently verified)

1. Goal: RuneScape preservation via open source; an initiative "ongoing since 2022" to recreate forever-lost RS2 versions. Jagex is said to have no backups of 2004/2005 and very few later.
2. Caches hold only assets: "Caches do not have any of the server logic - no quests, no skills, no shops, no interactions, all that is figured out and pieced together by us." Old caches were lost by the community; they scraped what they could from RSPS and ask people to find more. This is why they jump between versions.
3. Content is written in "RuneScript", described as "our recreation of Jagex's own content language based on as much information as we could find publicly", with "educated guesses" for gaps.
4. They aim to preserve original bugs by following the reasoning that produces them ("spaghetti code"), not just copying outcomes.
5. Release schedule stated: rev 225 (target 2004-05-18) released 2025-04-15 after a 3-month "f2p-content" beta; rev 244 (2004-06-28) on 2025-07-12; rev 245 (2004-07-13) on 2025-10-24; rev 254 (2004-09-07) on 2026-01-03; rev 274 (2004-11-23) in development with no release date. Public hosting began 2025; about 2 years of open-source development before that (2023).

### From git/READMEs (read)

6. Current Engine-TS/Content history starts 2023-07-04 with a reset: commit `cdf2f2d4` "feat: RuneScript; New branch history" ("Made the full switch to RuneScript!"; compiler jars were shared on Discord). Earlier history, and the claimed 2022 start, are not in these repos.
7. Engine-TS describes itself as "Reverse-engineered engine code designed to accurately simulate the cycle behaviors of early RS2. Contains the necessary data tools and compatible network protocol." Source: `Engine-TS/README.md:8`. It links `Client-Java` as "a research project to decompile and understand the original code" (`Engine-TS/README.md:39`).
8. Engine-TS remote branches are named by revision: 225, 244, 245.2, 254, 274 (default `origin/HEAD`), 289, 377-node, 377-wip, 530-wip (`git -C Engine-TS branch -r`). Matching engine and content branches are required (`Engine-TS/README.md`).
9. Early engine work (July 2023): pathfinding ported from the Kotlin `rsmod` project (`git log` messages 2023-07-07 "WIP reach strategy conversion from rsmod", 2023-07-13 "convert most /rsmod/ code to TypeScript (#27)"), then moved to an `rsmod` dependency (2024-01-29) and an `rsmod wasm` build (2024-04-18).
10. Script compiler: `RuneScriptTS/README.md:61-71` says it began as a fork of Neptune's script compiler, that the initial compiler fork (2023-2026) was `RuneScriptKt` (Kotlin), and that as of February 2026 the project moved to this TypeScript clean port. Its own first commit is 2026-01-28.
11. Other repos start later: Client-TS 2025-01-16, Server launcher 2025-05-08.
12. Content licensing: "Assets within are the intellectual property of Jagex Ltd... originally obtained from their official software distribution channels then extracted here" (`Content/README.md:12-13`). So Jagex-made assets are extracted; the game rules (`Content/scripts/*`) are the team's own work (per FAQ #2, #3).

## Inferences (labelled)

- The server logic is recreated, not extracted: rests on findings 2, 3, 7. The `.rs2` content and the engine are authored by the Lost City team to reproduce observed behaviour; the FAQ does not say how observations were gathered (not verified).
- `Content/scripts/_unpack/274/all.obj` etc. look like text config definitions unpacked from the cache (name, desc, cost, model); this is from the folder name and file shape only, not from reading the unpack code.

## Not checked / open questions

- What the 2022-2023 pre-reset history was (not in git here); how they observed behaviour; what "published information" the RuneScript recreation drew on.
- Whether Client-TS is a port of Jagex's decompiled Java client (its README only holds a license; `Client-Java` not read).
- Whether any "client scripts" (e.g. interface scripts) are extracted from the cache vs written by the team. Logged in `open-questions.md` (#54, #55).
- FAQ release dates not cross-checked against branch history.
