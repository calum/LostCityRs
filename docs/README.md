# Documentation index

Rules: everything here must be evidenced and accurate. See [`../README.md`](../README.md#ground-rules-evidence-only-no-guessing) and [`../CLAUDE.md`](../CLAUDE.md).

## Notes

_None yet._ Add each note here as it is written, with a one-line summary.

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
