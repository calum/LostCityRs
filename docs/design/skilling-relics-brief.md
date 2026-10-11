# Skilling and route relics: brief for the project manager

Status: agreed with Calum 2026-10-11 (plan: all 9 relics, defaults accepted). Nothing implemented yet. Written against root `main`; re-check hashes before relying on file references.

Question this answers: what to build, in which work packages, to make skilling more rewarding and to give every skill and combat route a relic.

## Context (verified by reading `mods/relics/scripts/relic_gather.rs2` on main)

- Mining has Eternal Vein (10), woodcutting has Evergreen (11), Double Yield (12) covers gathering and fish cooking.
- Fishing has no auto-bank relic (`relic_fished` calls `relic_gathered(..., 0)`, so catches go to the inventory).
- No relics exist for fletching, crafting, runecrafting or ranged. Magic only has Infinite Runes (15).
- Calum's run: 90 mining with a bronze pickaxe took most of the time.

## Hard rules for every work package

- Follow `CLAUDE.md`: failing headless test first, suite green on Node 24.11.1+, push straight to `main`, hooks are one commit each in the forks (origin only), record in `docs/local-changes.md`, update docs and the player guide (`/guide/relic-mode-player-guide/`) in plain player wording.
- Do not bring back removed relics: Tutor, Prodigy, Free Teleports, Boss Key, Compass, Fleet Foot, Featherweight, Pathfinder, Reroll, Fast Hands, Smelter's Blessing.
- Pull/rebase before pushing. Other threads touch Double Yield/fishing and the all-relics completability test (`tests/`, added in f7b60a9, c59b9d6).
- Every new task and relic must keep the all-relics completability test green: with all relics owned, every task must still be completable. Extend that test for each new task.
- Use Sonnet or Haiku for subagents.

## New tasks (7, skilling)

Mine coal; smelt a steel bar; smith an adamant platebody; smith a rune scimitar; catch a lobster; mine an adamantite ore; cook a shark. ("Smelt a mithril bar" was rejected: Eternal Vein auto-smelts it.) Add more tasks for fletching, crafting, runecrafting and magic so those routes can earn offers (propose them to Calum, one line each).
Note: with Eternal Vein, iron smelts to steel and gems/coal stay unsmelted (`relic_smelt_ore`), so check each task is still completable.

## New relics (9)

1. **Prospector's Pick**: mining (any pickaxe), fishing (net, harpoon, cage, rods) and woodcutting (any axe) are all 2-tick.
2. **Forge Echo**: smelting and smithing have a 50% chance of one extra product, sent to the bank, granting the XP. Also rolls per bar for Eternal Vein auto-smelting.
3. **Endless Shoal**: fishing counterpart of Eternal Vein. Spots never move away, catches go straight to the bank (cooked if Double Yield is owned).
4. **Fletcher's Echo**: fletching has a 50% chance of an extra product, banked, with XP.
5. **Hunter's Haul**: NPC hide drops come as triple hides, auto-tanned, straight to the bank, plus 50% chance of a random uncut gem.
6. **Rune Wellspring**: a talisman teleports to any runecrafting altar (widget). Every XP gain in any skill adds stackable Rune Essence Bundles to the inventory (bank if full); default 1 bundle per 100 XP gained. Using a bundle on an altar crafts 100 pure essence into runes at once.
7. **Archmage**: spell damage x2, half cast time, a 50% chance each cast to not use up runes, and after a cast it keeps auto-casting the last used spell at the same target until you stop (how the engine supports this is not yet checked). Replaces Infinite Runes as the magic relic.
8. **Endless Quiver**: ammo never used up, +50% attack roll and +50% damage (matches the combat relics).
9. **Teleport Network**: opens a widget listing the main cities; clicking one teleports there. Replaces Infinite Runes' slot.

Remove Infinite Runes (15): also revert its client change (Client-TS a822635) and the server rune-check skip. Check what happens for characters that already own it.

## Suggested work packages

A. Skilling relics 1 to 5 (hooks in mining, woodcutting, fishing, smithing, fletching, crafting, npc_death drops).
B. Rune Wellspring (6): new obj, XP hook, altar widget.
C. Archmage and Endless Quiver (7, 8): combat hooks.
D. Teleport Network and Infinite Runes removal (9, 15).
E. Tasks, all-relics test, offer pool/eligibility, relic menus, docs, player guide.

## Open questions

- Interfaces needed for B and D (a new `.if` in `mods/relics/interfaces/`): not yet checked.
- Whether relic ids up to about 28 fit the owned-relic bitmask: not verified.
- Exact engine hook sites for 2-tick gathering, fishing spot relocation, fletching and smithing product creation: not yet located.
