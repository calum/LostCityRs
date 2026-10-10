# Submodule forks and merging from upstream

**Question:** where do the submodules point, and how do I pull upstream changes into the forks?

**Based on:** root repo `0ea23a1`; submodule pointers unchanged (Engine-TS `1d25566`, Content `65b754f`, Client-TS `7d6ca61`, RuneScriptTS `c454554`, Server `0b6a0cb`). Method: `git ls-remote` on both upstream and fork showed identical `HEAD` hashes for all five on 2026-10-10 (read, not run). Not checked: fork default branches/branch lists; whether the forks include non-default branches (e.g. the `274` branch the upstream READMEs mention).

## Findings

| Submodule | Fork (`origin`) | Upstream |
|---|---|---|
| Engine-TS | https://github.com/calum/Engine-TS.git | https://github.com/LostCityRS/Engine-TS.git |
| Content | https://github.com/calum/Content.git | https://github.com/LostCityRS/Content.git |
| Client-TS | https://github.com/calum/Client-TS.git | https://github.com/LostCityRS/Client-TS.git |
| RuneScriptTS | https://github.com/calum/RuneScriptTS.git | https://github.com/LostCityRS/RuneScriptTS.git |
| Server | https://github.com/calum/Server.git | https://github.com/LostCityRS/Server.git |

- `.gitmodules` `url` values now point at the forks; the recorded commits did not change, so nothing else moves.
- The forks were created by Calum in the GitHub UI. This agent environment could not create them: `gh api -X POST repos/LostCityRS/<name>/forks` returned HTTP 403 "Write access to this GitHub API path is not permitted through this proxy".
- Rule: push only to the forks, never to `LostCityRS/*` (see `CLAUDE.md`).

## Existing clones (e.g. Calum's laptop)

Run in the root repo after pulling this change:

```sh
git submodule sync --recursive      # copies .gitmodules URLs into .git/config and each submodule's origin
```

Then, per submodule, add upstream as fetch-only:

```sh
cd Engine-TS
git remote add upstream https://github.com/LostCityRS/Engine-TS.git
git remote set-url --push upstream DISABLED_NO_PUSH
```

## Merging upstream into a fork (inference from standard git; not run here)

```sh
cd Engine-TS
git fetch upstream
git checkout main
git merge upstream/<branch>         # or rebase; resolve conflicts
git push origin main      # fork only
cd ..
git add Engine-TS && git commit -m "Update Engine-TS pointer" && git push origin main
```

Upstream READMEs require Engine and Content on matching revision branches; merge both from the same upstream branch. After moving a pointer, re-check the commit hashes in docs (`docs/tools/check_citations.py`).

## Branches in the forks (2026-10-10)

Engine-TS, Content and Client-TS each had the upstream `274` branch plus Calum's branch (`relic-mode` for Engine-TS and Content, `calum-research` for Client-TS). Each was a pure fast-forward of `274` (2, 33 and 2 commits ahead, 0 behind; `git rev-list --count`), so `main` was created at the same commit with no merge: Engine-TS `8c4fa9ca`, Content `c8cff7b57`, Client-TS `93b19c3`. RuneScriptTS and Server only had `main`. The root's submodule pointers did not change. The old branches are kept; `274` was left untouched.

## Open questions

- Do the forks contain all upstream branches and tags? Only `HEAD` was compared.
