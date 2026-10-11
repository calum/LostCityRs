# Relic item icons (no more rune lookalikes)

**Question:** can the relic items get their own inventory/bank icon instead of reusing rune models, which is confusing in a magic run?
**Based on:** root `d596090`, Content `514e71556`, Engine-TS `33564f19`, Client-TS `cd03818`. Method: read code and model files, rendered the models with my own script, ran the headless suite. **Not run in the real client** (see limits).

## How an item icon is made (read)

- An obj's icon is a model from the cache plus optional recolours: `Client-TS/src/config/ObjType.ts:315-318` loads `Model.load(this.model)` and calls `model.recolour(recol_s[i], recol_d[i])`; `Client-TS/src/dash3d/Model.ts:1428-1437` replaces every face whose 16-bit colour equals the source value exactly.
- Models are packed as-is from `Content/models/**/*.ob2` (`Engine-TS/tools/pack/graphics/pack.ts:43-69`). So a new icon needs no new file when an existing model plus a recolour will do; a truly new model would need a new `.ob2` (not attempted).
- `2dzoom`, `2dxan`, `2dyan`, `2dxof`, `2dyof` in the obj frame the model (`ObjType.ts` fields `zoom2d`, `xan2d`).
- **Recolour keys must be the colours stored in the `.ob2`.** Many existing items carry recolour sources that do not occur in the repo's model files (e.g. `orb_of_protection` uses `recol1s=32767` but `inv_glowingorb.ob2` holds `127`): checked by script, 3 of 1727 recolour sources matched the model's face colours. Inference: most existing recolours are stale no-ops. Do not copy a `recolNs` from another item; read the faces (`docs/tools/model_preview.py` shows how: trailer layout from `Model.ts:138-210`, face colours at `faceColourOffset`).

## What changed (`mods/relics/configs/relic_items.obj`)

| Item | Was | Now | Recolour |
|---|---|---|---|
| Recall stone | `inv_lawrune` | `inv_glowingorb` (white orb) | face colour 127 to 52058, purple |
| Banker's stone | `inv_cosmicrune` | `inv_casket` (brown chest, gold lock) | none |
| Network stone | `inv_naturerune` | `inv_map_scroll` (rolled map) | 5452, 5427, 5440 to 37328, 37318, 37323, blue |
| Wellspring talisman | `inv_runetalisman_air` | `inv_talisman` (wheel) | 5596 to 29530, teal |
| Rune essence bundle | `inv_blankrune` | unchanged | |

View parameters are copied from existing items that use the same model (casket in `skill_fishing/configs/fishing.obj`, map in `general_use/configs/newcomer_map.obj`, talisman in `quests/quest_itexam/configs/quest_itexam.obj`; the orb uses `2dzoom=1260`, `2dxan=48` from `quest_tree`). The item names, descriptions, ops and scripts are untouched.

Preview (my own approximate software render of the `.ob2` files with the new recolours, not the game client; lighting and framing differ): ![preview](../assets/relic-item-icons.png) Order: Recall, Banker's, Network, Wellspring.

## Tests

`tests/relic-item-icons.test.ts` (3 tests): each item's packed model id, none is a rune or rune-talisman model, recolours present, bundle unchanged. First run failed on the old rune models; after the swap the 3 tests pass. Full suite 370/370 on Node 24.11.1, `tsc -p harness/tsconfig.json` clean. Run with `world.json` from `config/` copied in (the pack step otherwise stops on the `.npc` checksum).

## Limits and open questions

- Not covered by the harness: how the icons actually look in the client (rendering). Colours and framing are judged from my render only.
- Truly custom art (a new model from scratch, or a 2D sprite) was not tried; it needs a new `.ob2` in `Content/models/inv/` and a `model.pack` id, and a way to author the mesh (no tooling checked).
- Players with the old items keep working: only the model changed, obj ids and names are the same.
