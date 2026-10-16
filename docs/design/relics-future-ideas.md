# Relic mode: parked future ideas (post-final-wave and endless)

**Status (Calum, 2026-10-16): ideas only, for future development. Nothing is implemented, designed in detail or verified against code.** Do not build any of these until Calum asks. Related: the bonus final fight in `docs/design/relics-bonus-boss-fight.md` (the "special final wave with multiple KQ and KBD" these ideas build on) and `docs/design/relic-task-candidates.md` (other parked ideas).

**Not checked:** no code was read for this note. Where it says what the engine "would need", that is not verified.

Calum's wording, kept as given:

## 1. Congratulating bot players after the final wave

**Built 2026-10-16:** see [relics-party-bots.md](relics-party-bots.md) (cosmetic server-side npcs, not real logins).

> After finishing the special final wave with multiple KQ and KBD, it would be funny if a load of bot players spawned in following each of us, randomly distributed between the online players and we're saying congratulations and various messages like that. Their usernames would be from a famous list like zezima, b0aty, soup, framed, settled, woox and so on. The more of them spawned in the funnier.

Details recorded:
- Trigger: finishing the special final wave (multiple KQ and KBD).
- Bots follow the players, spread randomly across the online players.
- They chat congratulations and similar messages.
- Names come from a list of famous players (zezima, b0aty, soup, framed, settled, woox, and so on). More bots is funnier.

## 2. Endless mode

> An option to do an endless mode where we see how many we can kill and each one instantly respawns after dying and the kill count is announced in the chat every time we kill another NPC.

Details recorded:
- Opt-in mode: see how many NPCs can be killed.
- Each NPC respawns instantly after dying.
- The running kill count is announced in chat on every kill.

## 3. Leaderboard

> A leaderboard to show time played and rank lowest to highest and host at hiscores.rogue-relics.co.uk

Details recorded:
- Shows time played, ranked lowest (best) to highest.
- To be hosted at `hiscores.rogue-relics.co.uk`.
- Existing related data: play time and final-challenge time are already shown in the Relics menu (see `docs/design/relics-menus.md`); the existing hosting notes are in `docs/setup/hosting-for-friends.md`. Neither was re-read for this note.

## Open questions

- Whether bots should be real fake logins or scripted entities: not investigated (see `docs/open-questions.md`).
- How a public leaderboard receives results from a self-hosted server: not investigated.
