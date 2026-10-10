// The two relic menus opened from the settings tab (mods/relics/interfaces/*.if, mods/relics/scripts/relic_menus.rs2):
// a task list with a "hide completed" toggle, and a relic overview that can re-open a pending relic choice.
// Buttons are clicked with IF_BUTTON like the client does; text is read from the IF_SETTEXT packets the server sent.
// Design notes: docs/design/relics-menus.md.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Bot, useWorld } from '../harness/src/index.js';
import Component from '../Engine-TS/src/cache/config/Component.js';
import IfSetHide from '../Engine-TS/src/network/game/server/model/IfSetHide.js';
import { hasVarp } from './helpers.js';

useWorld();

const skip = () => (hasVarp('relic_started') ? false : 'relic mod not loaded');

const TAB_GAME_OPTIONS = 11; // ^tab_game_options (Content/scripts/general/configs/tabs.constant)
const bit = (id: number) => 1 << id;

/** Latest text the server set on a component, e.g. text(bot, 'relic_taskmenu:row_1'). */
function text(bot: Bot, com: string): string {
    const t = bot.texts.get(com);
    assert.notEqual(t, undefined, `no text was ever set on ${com}`);
    return t as string;
}

/** True if the latest if_sethide on the component hid it; false if it was shown; undefined if never touched. */
function hidden(bot: Bot, com: string): boolean | undefined {
    const id = Component.getId(com);
    assert.notEqual(id, -1, `unknown component ${com}`);
    let out: boolean | undefined;
    for (const r of bot.player.received) {
        if (r.message instanceof IfSetHide && r.message.component === id) out = r.message.hidden;
    }
    return out;
}

const taskRows = (bot: Bot) => Array.from({ length: 25 }, (_, i) => text(bot, `relic_taskmenu:row_${i + 1}`));
const shownTasks = (bot: Bot) => taskRows(bot).filter(r => r !== '');

function openTasks(bot: Bot) {
    bot.clickButton('options:relic_tasks').tick();
    assert.equal(bot.mainModal, 'relic_taskmenu');
}

function openRelics(bot: Bot) {
    bot.clickButton('options:relic_relics').tick();
    assert.equal(bot.mainModal, 'relic_relicmenu');
}

// if_sethide only hides layers in the client (Client-TS Client.ts IF_SETHIDE sets .hide, drawing checks it for type 0), so the choose button sits in a layer.
function relicRows(bot: Bot, list: 'unlocked' | 'available') {
    return Array.from({ length: 19 }, (_, i) => text(bot, `relic_relicmenu:${list}_${i + 1}`)).filter(r => r !== '');
}

test('the settings tab has a Tasks and a Relics button that open the menus', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn({ varps: { relic_started: 1 } });
    openTasks(bot);
    bot.closeModal().tick();
    assert.equal(bot.mainModal, null);
    openRelics(bot);
});

test('the low detail settings tab has the same two buttons', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn({ varps: { relic_started: 1 } });
    bot.player.tabs[TAB_GAME_OPTIONS] = Component.getId('options_ld');
    bot.clickButton('options_ld:relic_tasks').tick();
    assert.equal(bot.mainModal, 'relic_taskmenu');
    bot.clickButton('options_ld:relic_relics').tick();
    assert.equal(bot.mainModal, 'relic_relicmenu');
});

test('task menu: all 25 tasks listed with done and not done marks, and a count', t => {
    if (skip()) return t.skip(String(skip()));
    // tasks 1 (goblin) and 3 (giant) done: bits 0 and 2
    const bot = Bot.spawn({ varps: { relic_started: 1, relic_tasks_done: bit(0) | bit(2) } });
    openTasks(bot);
    const rows = taskRows(bot);
    assert.equal(rows.length, 25);
    assert.ok(rows.every(r => r !== ''));
    assert.match(rows[0], /^@gre@\[x\] 1\. Defeat a goblin$/);
    assert.match(rows[1], /^@whi@\[ \] 2\. Defeat a lesser demon$/);
    assert.match(rows[2], /^@gre@\[x\] 3\. Defeat a giant$/);
    assert.match(rows[24], /^@whi@\[ \] 25\. Defeat the Kalphite Queen$/);
    assert.match(text(bot, 'relic_taskmenu:summary'), /2 of 25/);
    assert.match(text(bot, 'relic_taskmenu:toggle'), /Hide completed: Off/);
});

test('task menu: the toggle hides completed tasks and packs the rest to the top', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn({ varps: { relic_started: 1, relic_tasks_done: bit(0) | bit(2) } });
    openTasks(bot);
    bot.clickButton('relic_taskmenu:toggle').tick();
    assert.equal(bot.mainModal, 'relic_taskmenu', 'the toggle must not close the menu');
    assert.equal(bot.varp('relic_hide_done'), 1);
    assert.match(text(bot, 'relic_taskmenu:toggle'), /Hide completed: On/);
    const shown = shownTasks(bot);
    assert.equal(shown.length, 23);
    assert.match(shown[0], /^@whi@\[ \] 2\. Defeat a lesser demon$/);
    assert.match(shown[1], /^@whi@\[ \] 4\. /);
    assert.ok(shown.every(r => r.startsWith('@whi@')));
    // rows are packed: no empty row sits between two shown rows
    const rows = taskRows(bot);
    assert.deepEqual(rows.slice(23), ['', '']);
    // toggling back shows everything again
    bot.clickButton('relic_taskmenu:toggle').tick();
    assert.equal(bot.varp('relic_hide_done'), 0);
    assert.equal(shownTasks(bot).length, 25);
});

test('task menu: the hide setting is remembered across relog', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn({ varps: { relic_started: 1, relic_tasks_done: bit(4) } });
    openTasks(bot);
    bot.clickButton('relic_taskmenu:toggle').tick();
    const again = bot.relog();
    assert.equal(again.varp('relic_hide_done'), 1);
    openTasks(again);
    assert.equal(shownTasks(again).length, 24);
    assert.match(text(again, 'relic_taskmenu:toggle'), /Hide completed: On/);
});

test('task menu: a button jumps to the relic menu', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn({ varps: { relic_started: 1 } });
    openTasks(bot);
    bot.clickButton('relic_taskmenu:to_relics').tick();
    assert.equal(bot.mainModal, 'relic_relicmenu');
    bot.clickButton('relic_relicmenu:to_tasks').tick();
    assert.equal(bot.mainModal, 'relic_taskmenu');
});

test('relic menu: nothing owned: XP rate 8x, empty unlocked list, all 19 available', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn({ varps: { relic_started: 1 } });
    openRelics(bot);
    assert.match(text(bot, 'relic_relicmenu:xp'), /XP rate: 8x/);
    assert.deepEqual(relicRows(bot, 'unlocked'), []);
    const available = relicRows(bot, 'available');
    assert.equal(available.length, 19);
    assert.match(available[0], /XP Multiplier/);
    assert.match(available[0], /16x/, 'the XP Multiplier row names the next rate');
    assert.match(text(bot, 'relic_relicmenu:unlocked_title'), /\(0\)/);
    assert.match(text(bot, 'relic_relicmenu:available_title'), /\(19\)/);
});

test('relic menu: owned relics and the XP tier move to the unlocked list', t => {
    if (skip()) return t.skip(String(skip()));
    // Stoneskin (3) and Phoenix (6), and XP Multiplier tier 2 (8x * 4 = 32x)
    const bot = Bot.spawn({ varps: { relic_started: 1, relic_owned: bit(3) | bit(6), relic_xp_tier: 2, relic_xp_factor: 4 } });
    openRelics(bot);
    assert.match(text(bot, 'relic_relicmenu:xp'), /XP rate: 32x/);
    const unlocked = relicRows(bot, 'unlocked');
    assert.equal(unlocked.length, 3);
    assert.match(unlocked[0], /XP Multiplier/);
    assert.match(unlocked[0], /32x/);
    assert.match(unlocked[1], /Stoneskin/);
    assert.match(unlocked[1], /half damage taken/);
    assert.match(unlocked[2], /Phoenix/);
    const available = relicRows(bot, 'available');
    assert.equal(available.length, 17); // 19 - Stoneskin - Phoenix; XP Multiplier still has tier 3 to go
    assert.ok(!available.some(r => /Stoneskin|Phoenix/.test(r)));
    assert.match(available[0], /XP Multiplier/);
    assert.match(available[0], /64x/);
    assert.match(text(bot, 'relic_relicmenu:unlocked_title'), /\(3\)/);
});

test('relic menu: a maxed XP multiplier leaves the available list', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn({ varps: { relic_started: 1, relic_xp_tier: 3, relic_xp_factor: 8 } });
    openRelics(bot);
    assert.match(text(bot, 'relic_relicmenu:xp'), /XP rate: 64x/);
    assert.equal(relicRows(bot, 'available').length, 18);
    assert.ok(!relicRows(bot, 'available').some(r => /XP Multiplier/.test(r)));
});

test('relic menu: no pending choice hides the choose button', t => {
    if (skip()) return t.skip(String(skip()));
    const bot = Bot.spawn({ varps: { relic_started: 1, relic_pending: 0 } });
    openRelics(bot);
    assert.equal(hidden(bot, 'relic_relicmenu:choose_box'), true);
    assert.match(text(bot, 'relic_relicmenu:pending'), /No relic choice is waiting/);
});

test('relic menu: a pending choice shows the button, and clicking it re-opens the offer without relogging', t => {
    if (skip()) return t.skip(String(skip()));
    // relic_pending was left at 1 by a closed dialog; the seed is fixed so the draw is predictable
    const bot = Bot.spawn({ varps: { relic_started: 1, relic_pending: 1, relic_seed: 5 } });
    bot.tick(5);
    // the login hook queued the offer already; close it like a player who dismissed it
    bot.closeModal().tick(2);
    assert.equal(bot.chatModal, null);
    assert.equal(bot.varp('relic_pending'), 1);

    openRelics(bot);
    assert.equal(hidden(bot, 'relic_relicmenu:choose_box'), false);
    assert.match(text(bot, 'relic_relicmenu:pending'), /1 relic choice waiting/);
    bot.clickButton('relic_relicmenu:choose');
    bot.waitUntil(() => bot.inDialog, 20, 'the relic offer');
    assert.equal(bot.mainModal, null, 'the menu closes so the offer can show');
    assert.match(bot.dialogText, /Choose a relic/);
    assert.equal(bot.choices.length, 3);
    bot.choose(1);
    bot.waitUntilIdle(20);
    assert.equal(bot.varp('relic_pending'), 0);
    assert.ok(bot.varp('relic_owned') !== 0 || bot.varp('relic_xp_tier') !== 0, 'the pick was granted');

    // the menu now shows the new relic and no pending choice
    openRelics(bot);
    assert.equal(hidden(bot, 'relic_relicmenu:choose_box'), true);
    assert.ok(relicRows(bot, 'unlocked').length >= 1);
});
