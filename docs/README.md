# Documentation index

Rules: everything here must be evidenced and accurate. See [`../README.md`](../README.md#ground-rules-evidence-only-no-guessing) and [`../CLAUDE.md`](../CLAUDE.md).

## Notes

- [flows/click-loc-woodcutting.md](flows/click-loc-woodcutting.md): clicking a tree. Client packet, engine decode/handler, interaction processing in the tick, and the Content script that runs (read from code, not run).
- [flows/server-response-woodcutting.md](flows/server-response-woodcutting.md): the return path. How `mes`, `anim`, `sound_synth`, `inv_add` and `stat_advance` become packets and what the client does with them (read from code, not run).
- [flows/move-opclick.md](flows/move-opclick.md): how the client's walking route (`MOVE_OPCLICK`) is decoded, queued as waypoints and walked tick by tick (read from code, not run).

Add each new note here with a one-line summary.

## Note template

```markdown
# <Title>

**Question answered:** <one sentence>

**Based on commits:**
- Engine-TS: `<hash>` (branch `calum-research`, based on `<upstream branch>`)
- Content: `<hash>`
- Client-TS: `<hash>`
- (only list the repos actually read)

**Method:** read code / ran the server and observed (say which)

## Findings

1. <Claim>. Source: `Engine-TS/src/...:LINE`
   ```ts
   // short quoted snippet if it carries the meaning
   ```

## Inferences (labelled)

- <Inference> — rests on findings 1 and 3.

## Not checked / open questions

- <Thing not verified>. Also logged in `open-questions.md`.
```
