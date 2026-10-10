// High-level test API: one Bot = one logged-in headless player in the in-process World.
//
// Two ways to act:
// - "Client input" methods (opNpc, opLoc, opHeld, opObj, useOn*, walkTo, continueDialog, choose,
//   clickButton, cheat, debugproc) queue a packet that the engine's own handler processes in the next
//   tick's processClientsIn, exactly where a real packet would land. The handler's checks apply
//   (delayed, option exists, item in that slot, NPC visible to this client, ...).
// - "Server-side" methods (teleport, give, setVar, setLevel, call) change state directly between
//   ticks, like a cheat would. Use them to set up a scenario quickly.

// world.js first: it imports World.ts, which must load before the entity/config modules (their
// circular imports only resolve in the order app.ts uses).
import { serverLog, stepTick, World } from './world.js';

import Component from '../../Engine-TS/src/cache/config/Component.js';
import InvType from '../../Engine-TS/src/cache/config/InvType.js';
import LocType from '../../Engine-TS/src/cache/config/LocType.js';
import NpcType from '../../Engine-TS/src/cache/config/NpcType.js';
import ObjType from '../../Engine-TS/src/cache/config/ObjType.js';
import ScriptVarType from '../../Engine-TS/src/cache/config/ScriptVarType.js';
import SeqType from '../../Engine-TS/src/cache/config/SeqType.js';
import VarPlayerType from '../../Engine-TS/src/cache/config/VarPlayerType.js';
import { CoordGrid } from '../../Engine-TS/src/engine/CoordGrid.js';
import { EntityLifeCycle } from '../../Engine-TS/src/engine/entity/EntityLifeCycle.js';
import Loc from '../../Engine-TS/src/engine/entity/Loc.js';
import Npc from '../../Engine-TS/src/engine/entity/Npc.js';
import Obj from '../../Engine-TS/src/engine/entity/Obj.js';
import { getExpByLevel } from '../../Engine-TS/src/engine/entity/Player.js';
import { PlayerLoading } from '../../Engine-TS/src/engine/entity/PlayerLoading.js';
import { PlayerStatMap } from '../../Engine-TS/src/engine/entity/PlayerStat.js';
import { findPath, findPathToEntity, findPathToLoc } from '../../Engine-TS/src/engine/GameMap.js';
import ScriptProvider from '../../Engine-TS/src/engine/script/ScriptProvider.js';
import ScriptRunner from '../../Engine-TS/src/engine/script/ScriptRunner.js';
import ScriptState from '../../Engine-TS/src/engine/script/ScriptState.js';
import Packet from '../../Engine-TS/src/io/Packet.js';
import ClientGameProt from '../../Engine-TS/src/network/game/client/ClientGameProt.js';
import ClientCheat from '../../Engine-TS/src/network/game/client/model/ClientCheat.js';
import CloseModal from '../../Engine-TS/src/network/game/client/model/CloseModal.js';
import IfButton from '../../Engine-TS/src/network/game/client/model/IfButton.js';
import MoveClick from '../../Engine-TS/src/network/game/client/model/MoveClick.js';
import OpHeld from '../../Engine-TS/src/network/game/client/model/OpHeld.js';
import OpHeldU from '../../Engine-TS/src/network/game/client/model/OpHeldU.js';
import OpLoc from '../../Engine-TS/src/network/game/client/model/OpLoc.js';
import OpLocU from '../../Engine-TS/src/network/game/client/model/OpLocU.js';
import OpNpc from '../../Engine-TS/src/network/game/client/model/OpNpc.js';
import OpNpcU from '../../Engine-TS/src/network/game/client/model/OpNpcU.js';
import OpObj from '../../Engine-TS/src/network/game/client/model/OpObj.js';
import ResumePauseButton from '../../Engine-TS/src/network/game/client/model/ResumePauseButton.js';
import ResumePCountDialog from '../../Engine-TS/src/network/game/client/model/ResumePCountDialog.js';
import IfSetText from '../../Engine-TS/src/network/game/server/model/IfSetText.js';
import MessageGame from '../../Engine-TS/src/network/game/server/model/MessageGame.js';

import { TestPlayer } from './TestPlayer.js';

export type Coord = { x: number; z: number; level?: number };
export type CoordLike = Coord | string;

/** Lumbridge castle courtyard, off Tutorial Island. */
export const LUMBRIDGE: Coord = { x: 3222, z: 3218, level: 0 };

export interface SpawnOptions {
    /** Username (max 12 chars). Default: a unique "t<n>". */
    name?: string;
    /** Where to log in. Default LUMBRIDGE. */
    at?: CoordLike;
    /** Mark Tutorial Island done (%tutorial = 1000, Content general/configs/quest.constant). Default true. */
    tutorialDone?: boolean;
    /** Staff level. 4 lets the bot run ::~debugprocs (ClientCheatHandler.ts:57). Default 4. */
    staff?: number;
    /** Varps to set before login, by name, e.g. { relic_offered: 1 }. Applied before the [login] script runs. */
    varps?: Record<string, number>;
    /** Base levels to set before login, by stat name, e.g. { woodcutting: 60 }. */
    levels?: Record<string, number>;
    /** A save file (bytes from bot.save()) to log in with instead of a new character. */
    save?: Uint8Array;
    /** Fail the test if a RuneScript error is reported to this player. Default true. */
    failOnScriptError?: boolean;
}

let botCounter = 0;

export class HarnessError extends Error {}

export function parseCoord(c: CoordLike): Required<Coord> {
    if (typeof c !== 'string') {
        return { x: c.x, z: c.z, level: c.level ?? 0 };
    }
    // RuneScript coord literal: level_mapX_mapZ_localX_localZ (docs/reference/coordinates.md)
    const parts = c.split('_').map(n => parseInt(n, 10));
    if (parts.length !== 5 || parts.some(isNaN)) {
        throw new HarnessError(`Bad coord "${c}": expected level_mapX_mapZ_localX_localZ`);
    }
    const [level, mx, mz, lx, lz] = parts;
    return { level, x: (mx << 6) + lx, z: (mz << 6) + lz };
}

function idOf(kind: string, getId: (n: string) => number, nameOrId: string | number): number {
    if (typeof nameOrId === 'number') {
        return nameOrId;
    }
    const id = getId(nameOrId);
    if (id === -1) {
        throw new HarnessError(`Unknown ${kind} "${nameOrId}"`);
    }
    return id;
}

export const ids = {
    obj: (n: string | number) => idOf('obj', ObjType.getId.bind(ObjType), n),
    npc: (n: string | number) => idOf('npc', NpcType.getId.bind(NpcType), n),
    loc: (n: string | number) => idOf('loc', LocType.getId.bind(LocType), n),
    inv: (n: string | number) => idOf('inv', InvType.getId.bind(InvType), n),
    varp: (n: string | number) => idOf('varp', VarPlayerType.getId.bind(VarPlayerType), n),
    seq: (n: string | number) => idOf('seq', SeqType.getId.bind(SeqType), n),
    com: (n: string | number) => idOf('component', Component.getId.bind(Component), n),
    stat: (n: string | number) => {
        if (typeof n === 'number') return n;
        const id = PlayerStatMap.get(n.toUpperCase());
        if (id === undefined) throw new HarnessError(`Unknown stat "${n}"`);
        return id;
    }
};

export class Bot {
    /** Bots currently in the world (removed by useWorld() after each test). */
    static readonly live: Set<Bot> = new Set();
    /** Options merged under every spawn() call's own options (varps and levels are merged key by key). */
    static defaults: SpawnOptions = {};

    readonly player: TestPlayer;
    private failOnScriptError: boolean;
    private checkedMessages = 0;
    private lastLogout = false;

    private constructor(player: TestPlayer, failOnScriptError: boolean) {
        this.player = player;
        this.failOnScriptError = failOnScriptError;
    }

    /**
     * Log a headless player in. The bot joins through World.newPlayers, the same set a real login
     * goes into (World.onLoginMessage), and is placed in the world by World.processLogins, which runs
     * Player.onLogin and the [login] script. Returns after that tick.
     */
    static spawn(own: SpawnOptions = {}): Bot {
        const d = Bot.defaults;
        const options: SpawnOptions = {
            ...d,
            ...own,
            varps: { ...d.varps, ...own.varps },
            levels: { ...d.levels, ...own.levels }
        };
        const name = options.name ?? `t${++botCounter}`;
        const loaded = PlayerLoading.load(name, new Packet(options.save ?? new Uint8Array()), null);
        const player = TestPlayer.adopt(loaded);
        player.staffModLevel = options.staff ?? 4;
        player.lowMemory = false;
        player.members = true;

        if (!options.save) {
            const at = parseCoord(options.at ?? LUMBRIDGE);
            player.x = at.x;
            player.z = at.z;
            player.level = at.level;
            if (options.tutorialDone ?? true) {
                player.vars[ids.varp('tutorial')] = 1000;
            }
        } else if (options.at) {
            const at = parseCoord(options.at);
            player.x = at.x;
            player.z = at.z;
            player.level = at.level;
        }

        for (const [k, v] of Object.entries(options.varps ?? {})) {
            player.vars[ids.varp(k)] = v;
        }
        for (const [k, v] of Object.entries(options.levels ?? {})) {
            const stat = ids.stat(k);
            player.stats[stat] = getExpByLevel(v);
            player.baseLevels[stat] = v;
            player.levels[stat] = v;
        }

        World.newPlayers.add(player);
        const bot = new Bot(player, options.failOnScriptError ?? true);
        Bot.live.add(bot);
        bot.tick();
        if (player.slot === -1 || !player.isActive) {
            throw new HarnessError(`Bot ${name} did not get into the world (already logged in, or world full?)`);
        }
        return bot;
    }

    // ---------------------------------------------------------------- time

    /** Run n full game ticks. */
    tick(n = 1): this {
        for (let i = 0; i < n; i++) {
            stepTick();
            this.checkScriptErrors();
        }
        return this;
    }

    /**
     * Tick until `cond()` is true, checking before each tick. Throws (with the bot's recent state)
     * if it is still false after `maxTicks`. Returns how many ticks it took.
     */
    waitUntil(cond: () => boolean, maxTicks = 100, what = 'condition'): number {
        for (let i = 0; i <= maxTicks; i++) {
            if (cond()) {
                return i;
            }
            if (i < maxTicks) {
                this.tick();
            }
        }
        throw new HarnessError(`Timed out after ${maxTicks} ticks waiting for ${what}\n${this.describe()}`);
    }

    /** Tick until a game message matching `re` arrives (searching messages since the last expect/wait). */
    waitForMessage(re: RegExp | string, maxTicks = 100): string {
        let found: string | undefined;
        this.waitUntil(
            () => {
                found = this.findNewMessage(re);
                return found !== undefined;
            },
            maxTicks,
            `message ${re}`
        );
        return found!;
    }

    /** Tick until the bot is idle: no running/paused script, queue, interaction, walk or delay. */
    waitUntilIdle(maxTicks = 100): number {
        return this.waitUntil(() => this.idle, maxTicks, 'idle');
    }

    get idle(): boolean {
        const p = this.player;
        return p.activeScript === null && p.queue.head() === null && p.weakQueue.head() === null && p.engineQueue.head() === null && !p.hasInteraction() && p.waypointIndex === -1 && !p.delayed && p.pendingInput.length === 0;
    }

    // ---------------------------------------------------------------- state (read)

    get x() {
        return this.player.x;
    }
    get z() {
        return this.player.z;
    }
    get level() {
        return this.player.level;
    }
    get pos(): Required<Coord> {
        return { x: this.player.x, z: this.player.z, level: this.player.level };
    }

    /** Current (boosted/drained) level of a stat. */
    stat(stat: string | number): number {
        return this.player.levels[ids.stat(stat)];
    }
    baseLevel(stat: string | number): number {
        return this.player.baseLevels[ids.stat(stat)];
    }
    /** Experience in tenths of a point, as the engine stores it. */
    xp(stat: string | number): number {
        return this.player.stats[ids.stat(stat)];
    }

    varp(name: string | number): number | string {
        return this.player.getVar(ids.varp(name));
    }

    /** How many of `obj` are in `inv` (default the backpack, "inv"). */
    count(obj: string | number, inv: string | number = 'inv'): number {
        const container = this.player.getInventory(ids.inv(inv));
        if (!container) return 0;
        return container.getItemCount(ids.obj(obj));
    }

    /** Non-empty slots of an inventory as { slot, obj (debugname), count }. */
    items(inv: string | number = 'inv') {
        const container = this.player.getInventory(ids.inv(inv));
        if (!container) return [];
        const out: { slot: number; obj: string; count: number }[] = [];
        for (let i = 0; i < container.capacity; i++) {
            const item = container.get(i);
            if (item)
                out.push({
                    slot: i,
                    obj: ObjType.get(item.id).debugname ?? String(item.id),
                    count: item.count
                });
        }
        return out;
    }

    /** Every game message (`mes`) this player has been sent, oldest first. */
    get messages(): string[] {
        return this.player.received.filter(r => r.message instanceof MessageGame).map(r => (r.message as MessageGame).msg);
    }

    /** Text the server last set on each component, by component name. Dialogues are built this way. */
    get texts(): Map<string, string> {
        const out = new Map<string, string>();
        for (const r of this.player.received) {
            if (r.message instanceof IfSetText) {
                out.set(Component.get(r.message.component).comName ?? String(r.message.component), r.message.text);
            }
        }
        return out;
    }

    /** The open chat-box interface's name (dialogue, choice, ...), or null. */
    get chatModal(): string | null {
        return this.player.modalChat === -1 ? null : (Component.get(this.player.modalChat).comName ?? String(this.player.modalChat));
    }
    get mainModal(): string | null {
        return this.player.modalMain === -1 ? null : (Component.get(this.player.modalMain).comName ?? String(this.player.modalMain));
    }

    /** All text currently shown in the open chat-box interface, joined with " | ". */
    get dialogText(): string {
        const root = this.player.modalChat;
        if (root === -1) return '';
        const parts: string[] = [];
        const latest = new Map<number, string>();
        for (const r of this.player.received) {
            if (r.message instanceof IfSetText) latest.set(r.message.component, r.message.text);
        }
        for (const [com, text] of latest) {
            if (Component.get(com).rootLayer === root && text.length > 0) parts.push(text);
        }
        return parts.join(' | ');
    }

    /** True while a script is paused on p_pausebutton (a "click to continue" or a choice). */
    get inDialog(): boolean {
        return this.player.activeScript !== null && this.player.activeScript.execution === ScriptState.PAUSEBUTTON;
    }

    /** Lines printed by the server (including RuneScript `console(...)`) since tick `sinceTick`. */
    serverLog(sinceTick = 0): string[] {
        return serverLog.filter(l => l.tick >= sinceTick).map(l => l.text);
    }

    // ---------------------------------------------------------------- finding things

    /** Nearest active NPC of a type, within `radius` tiles on the bot's level. */
    findNpc(type: string | number, radius = 15): Npc {
        const id = ids.npc(type);
        let best: Npc | null = null;
        let bestDist = Infinity;
        for (const npc of World.npcs) {
            if (!npc || !npc.isActive || npc.type !== id || npc.level !== this.level) continue;
            const d = Math.max(Math.abs(npc.x - this.x), Math.abs(npc.z - this.z));
            if (d <= radius && d < bestDist) {
                best = npc;
                bestDist = d;
            }
        }
        if (!best) throw new HarnessError(`No ${type} within ${radius} tiles of ${this.x},${this.z},${this.level}`);
        return best;
    }

    /** Nearest loc of a type, within `radius` tiles on the bot's level. */
    findLoc(type: string | number, radius = 15): Loc {
        const id = ids.loc(type);
        let best: Loc | null = null;
        let bestDist = Infinity;
        for (let zx = this.x - radius; zx <= this.x + radius + 7; zx += 8) {
            for (let zz = this.z - radius; zz <= this.z + radius + 7; zz += 8) {
                for (const loc of World.gameMap.getZone(zx, zz, this.level).getAllLocsUnsafe()) {
                    if (loc.type !== id || !loc.isActive) continue;
                    const d = Math.max(Math.abs(loc.x - this.x), Math.abs(loc.z - this.z));
                    if (d <= radius && d < bestDist) {
                        best = loc;
                        bestDist = d;
                    }
                }
            }
        }
        if (!best) throw new HarnessError(`No loc ${type} within ${radius} tiles of ${this.x},${this.z},${this.level}`);
        return best;
    }

    /** Nearest ground obj of a type this player can see, within `radius`. */
    findObj(type: string | number, radius = 15): Obj {
        const id = ids.obj(type);
        for (let zx = this.x - radius; zx <= this.x + radius + 7; zx += 8) {
            for (let zz = this.z - radius; zz <= this.z + radius + 7; zz += 8) {
                for (const obj of World.gameMap.getZone(zx, zz, this.level).getAllObjsUnsafe()) {
                    if (obj.type !== id) continue;
                    if (Math.max(Math.abs(obj.x - this.x), Math.abs(obj.z - this.z)) > radius) continue;
                    if (World.getObj(obj.x, obj.z, obj.level, id, this.player.hash64)) return obj;
                }
            }
        }
        throw new HarnessError(`No ground obj ${type} within ${radius} tiles of ${this.x},${this.z},${this.level}`);
    }

    // ---------------------------------------------------------------- set-up (server side, immediate)

    /** Move instantly (PathingEntity.teleport, what p_teleport uses). Takes effect in the next tick's update. */
    teleport(to: CoordLike): this {
        const c = parseCoord(to);
        this.player.teleport(c.x, c.z, c.level);
        return this.tick();
    }

    /** Add items to an inventory (default backpack). Throws if they did not all fit. */
    give(obj: string | number, count = 1, inv: string | number = 'inv'): this {
        // Inventory.add returns how many were added
        const added = this.player.invAdd(ids.inv(inv), ids.obj(obj), count);
        if (added < count) throw new HarnessError(`give ${obj} x${count}: only ${added} fitted`);
        return this;
    }

    clearInv(inv: string | number = 'inv'): this {
        this.player.invClear(ids.inv(inv));
        return this;
    }

    setVar(name: string | number, value: number | string): this {
        this.player.setVar(ids.varp(name), value);
        return this;
    }

    /** Set base and current level (and matching XP) of a stat. */
    setLevel(stat: string | number, level: number): this {
        const s = ids.stat(stat);
        this.player.stats[s] = getExpByLevel(level);
        this.player.baseLevels[s] = level;
        this.player.levels[s] = level;
        return this;
    }

    /**
     * Run a script now, as this player (ScriptRunner.init + Player.executeScript, the path every
     * trigger uses). `name` is a full script name such as "[proc,relic_say]" or a bare proc name.
     * Arguments are converted by the script's parameter types: names for obj/npc/loc/inv/stat/seq,
     * "0_50_50_10_10" or {x,z,level} for coords, true/false for booleans.
     * Returns the script state so tests can read its result.
     */
    call(name: string, ...args: (string | number | boolean | Coord)[]): ScriptState {
        const full = name.startsWith('[') ? name : `[proc,${name}]`;
        const script = ScriptProvider.getByName(full);
        if (!script) throw new HarnessError(`No script ${full}`);
        const types = script.info.parameterTypes;
        if (types.length !== args.length) throw new HarnessError(`${full} takes ${types.length} argument(s), got ${args.length}`);
        const converted = args.map((a, i) => convertArg(types[i], a));
        const state = ScriptRunner.init(script, this.player, null, converted);
        this.player.executeScript(state, true, true);
        this.checkScriptErrors();
        return state;
    }

    // ---------------------------------------------------------------- client input (queued, real handlers)

    /** Type a `::` command. Runs through ClientCheatHandler next tick. Example: cheat("tele 0,50,50,10,10"). */
    cheat(text: string): this {
        this.player.send('CLIENT_CHEAT', ClientGameProt.CLIENT_CHEAT, new ClientCheat(text.replace(/^::/, '')));
        return this;
    }

    /** Run `[debugproc,name]` like typing ::~name args, then tick once so it has run. */
    debugproc(name: string, ...args: (string | number)[]): this {
        return this.cheat(`~${name}${args.length ? ' ' + args.join(' ') : ''}`).tick();
    }

    /** Click option `op` (1-5) on an NPC (by type name, or an Npc from findNpc). The engine paths there itself. */
    opNpc(npc: string | number | Npc, op = 1): this {
        const target = npc instanceof Npc ? npc : this.findNpc(npc);
        this.sendOpRoute(findPathToEntity(this.level, this.x, this.z, target.x, target.z, this.player.width, target.width, target.length));
        this.player.send(`OPNPC${op}`, opProt('OPNPC', op), new OpNpc(op, target.nid));
        return this;
    }

    /** Click option `op` (1-5) on a loc (by type name, or a Loc from findLoc). */
    opLoc(loc: string | number | Loc, op = 1): this {
        const target = loc instanceof Loc ? loc : this.findLoc(loc);
        this.sendOpRoute(this.routeToLoc(target));
        this.player.send(`OPLOC${op}`, opProt('OPLOC', op), new OpLoc(op, target.x, target.z, target.type));
        return this;
    }

    /** Click option `op` on a ground item (by type name, or an Obj from findObj). */
    opObj(obj: string | number | Obj, op = 3): this {
        const target = obj instanceof Obj ? obj : this.findObj(obj);
        this.sendOpRoute(findPath(this.level, this.x, this.z, target.x, target.z));
        this.player.send(`OPOBJ${op}`, opProt('OPOBJ', op), new OpObj(op, target.x, target.z, target.type));
        return this;
    }

    /** Click option `op` (1-5) on an item in the backpack (inventory:inv). Uses the first slot holding it. */
    opHeld(obj: string | number, op = 1): this {
        const { id, slot, com } = this.heldSlot(obj);
        this.player.send(`OPHELD${op}`, opProt('OPHELD', op), new OpHeld(op, id, slot, com));
        return this;
    }

    /** "Use" one backpack item on another. */
    useOnHeld(obj: string | number, onObj: string | number): this {
        const a = this.heldSlot(obj);
        const b = this.heldSlot(onObj);
        this.player.send('OPHELDU', ClientGameProt.OPHELDU, new OpHeldU(b.id, b.slot, b.com, a.id, a.slot, a.com));
        return this;
    }

    /** "Use" a backpack item on an NPC. */
    useOnNpc(obj: string | number, npc: string | number | Npc): this {
        const a = this.heldSlot(obj);
        const target = npc instanceof Npc ? npc : this.findNpc(npc);
        this.sendOpRoute(findPathToEntity(this.level, this.x, this.z, target.x, target.z, this.player.width, target.width, target.length));
        this.player.send('OPNPCU', ClientGameProt.OPNPCU, new OpNpcU(target.nid, a.id, a.slot, a.com));
        return this;
    }

    /** "Use" a backpack item on a loc. */
    useOnLoc(obj: string | number, loc: string | number | Loc): this {
        const a = this.heldSlot(obj);
        const target = loc instanceof Loc ? loc : this.findLoc(loc);
        this.sendOpRoute(this.routeToLoc(target));
        this.player.send('OPLOCU', ClientGameProt.OPLOCU, new OpLocU(target.x, target.z, target.type, a.id, a.slot, a.com));
        return this;
    }

    /**
     * Walk (or run with `run`) to a tile, as a game-screen click. The route is the engine's own
     * findPath (GameMap.ts) turned into waypoints, standing in for the client's route finder.
     * Returns where the route ends: findPath stops next to a blocked destination.
     */
    walkTo(to: CoordLike, run = false): Required<Coord> {
        const c = parseCoord(to);
        const route = findPath(this.level, this.x, this.z, c.x, c.z);
        const path = Array.from(route, p => {
            const u = CoordGrid.unpackCoord(p);
            return { x: u.x, z: u.z };
        });
        if (path.length === 0) path.push({ x: c.x, z: c.z });
        this.player.send('MOVE_GAMECLICK', ClientGameProt.MOVE_GAMECLICK, new MoveClick(path, run ? 1 : 0, false));
        const end = path[path.length - 1];
        return { x: end.x, z: end.z, level: this.level };
    }

    /** Walk to a tile and tick until standing on it. Fails at once if the route cannot reach it. */
    walk(to: CoordLike, maxTicks = 100): this {
        const c = parseCoord(to);
        const end = this.walkTo(c);
        if (end.x !== c.x || end.z !== c.z) {
            this.player.pendingInput.pop();
            throw new HarnessError(`walk: no route to ${c.x},${c.z}; the route finder stops at ${end.x},${end.z} (blocked tile?)`);
        }
        this.waitUntil(() => this.x === c.x && this.z === c.z, maxTicks, `arrival at ${c.x},${c.z}`);
        return this;
    }

    /** "Click here to continue" on the open dialogue (RESUME_PAUSEBUTTON), then tick. */
    continueDialog(): this {
        if (!this.inDialog) throw new HarnessError(`continueDialog: no dialogue is waiting\n${this.describe()}`);
        this.player.send('RESUME_PAUSEBUTTON', ClientGameProt.RESUME_PAUSEBUTTON, new ResumePauseButton());
        return this.tick();
    }

    /** Keep clicking "continue" until no dialogue is waiting or a choice appears. Returns the dialogue texts seen. */
    skipDialog(max = 50): string[] {
        const seen: string[] = [];
        for (let i = 0; i < max && this.inDialog; i++) {
            if (this.choices.length > 0) break;
            seen.push(this.dialogText);
            this.continueDialog();
        }
        return seen;
    }

    /** The options of the open choice dialogue (resume buttons, in order), with their text. */
    get choices(): string[] {
        const texts = new Map<number, string>();
        for (const r of this.player.received) {
            if (r.message instanceof IfSetText) texts.set(r.message.component, r.message.text);
        }
        return this.resumeButtons.map(c => texts.get(c) ?? Component.get(c).comName ?? String(c));
    }

    /**
     * Resume buttons of the open chat modal, without duplicates. `if_addresumebutton` only appends
     * (Engine-TS PlayerOps.ts), and `Player.openChatModal` clears `resumeButtons` only when it replaces
     * a script that is paused (Player.ts), not when the running script opens its next dialog. So a
     * script that shows a second choice dialog keeps the first one's buttons in the list, and
     * IfButtonHandler rejects those because they are no longer visible.
     */
    private get resumeButtons(): number[] {
        const root = this.player.modalChat;
        const out: number[] = [];
        for (const c of this.player.resumeButtons) {
            if (root !== -1 && Component.get(c).rootLayer !== root) continue;
            if (!out.includes(c)) out.push(c);
        }
        return out;
    }

    /** Pick a choice by 1-based index or by (part of) its text (IF_BUTTON on that resume button), then tick. */
    choose(option: number | string | RegExp): this {
        const buttons = this.resumeButtons;
        let index: number;
        if (typeof option === 'number') {
            index = option - 1;
        } else {
            const re = typeof option === 'string' ? new RegExp(escapeRe(option), 'i') : option;
            index = this.choices.findIndex(t => re.test(t));
        }
        if (index < 0 || index >= buttons.length) {
            throw new HarnessError(`choose(${option}): options are ${JSON.stringify(this.choices)}\n${this.describe()}`);
        }
        this.player.send('IF_BUTTON', ClientGameProt.IF_BUTTON, new IfButton(buttons[index]));
        return this.tick();
    }

    /** Click a button component by name, e.g. "logout:logout". */
    clickButton(com: string | number): this {
        this.player.send('IF_BUTTON', ClientGameProt.IF_BUTTON, new IfButton(ids.com(com)));
        return this;
    }

    /** Answer a "how many?" count dialogue (RESUME_P_COUNTDIALOG). */
    enterCount(n: number): this {
        this.player.send('RESUME_P_COUNTDIALOG', ClientGameProt.RESUME_P_COUNTDIALOG, new ResumePCountDialog(n));
        return this.tick();
    }

    /** Close the open interface (CLOSE_MODAL). */
    closeModal(): this {
        this.player.send('CLOSE_MODAL', ClientGameProt.CLOSE_MODAL, new CloseModal());
        return this;
    }

    // ---------------------------------------------------------------- assertions

    /** Assert a game message matching `re` arrived since the last expectMessage / waitForMessage. */
    expectMessage(re: RegExp | string): string {
        const found = this.findNewMessage(re);
        if (found === undefined) {
            throw new HarnessError(`Expected a message matching ${re}\n${this.describe()}`);
        }
        return found;
    }

    /** Assert no message matching `re` was ever sent to this player. */
    expectNoMessage(re: RegExp | string): void {
        const rx = toRe(re);
        const hit = this.messages.find(m => rx.test(m));
        if (hit !== undefined) throw new HarnessError(`Did not expect message "${hit}"\n${this.describe()}`);
    }

    // ---------------------------------------------------------------- lifecycle

    /** The player's save file bytes (Player.save), for a relog test. */
    save(): Uint8Array {
        return this.player.save();
    }

    /**
     * Remove the player from the world now (World.removePlayer), skipping the [logout] script and the
     * save write (the save is dropped from World.logoutRequests).
     */
    remove(): void {
        if (this.lastLogout) return;
        this.lastLogout = true;
        Bot.live.delete(this);
        World.removePlayer(this.player);
        World.logoutRequests.delete(this.player.username);
    }

    /** Save, remove, and log back in as a fresh object from the save bytes. */
    relog(): Bot {
        const bytes = this.save();
        const name = this.player.username;
        this.remove();
        this.tick();
        return Bot.spawn({
            name,
            save: bytes,
            staff: this.player.staffModLevel,
            failOnScriptError: this.failOnScriptError
        });
    }

    /** One-paragraph state dump for failure messages. */
    describe(): string {
        const p = this.player;
        const msgs = this.messages.slice(-8);
        const script = p.activeScript ? `${p.activeScript.script.name} (state ${p.activeScript.execution})` : 'none';
        const inputs = p.inputLog.slice(-5).map(i => `${i.prot}@${i.tick}${i.accepted ? '' : ' REJECTED'}`);
        return [
            `  bot ${p.username} at ${p.x},${p.z},${p.level} tick ${World.currentTick}`,
            `  active script: ${script}; chat modal: ${this.chatModal}; main modal: ${this.mainModal}; delayed: ${p.delayed}`,
            `  dialogue: ${this.dialogText || '-'}`,
            `  last inputs: ${inputs.join(', ') || '-'}`,
            `  last messages: ${msgs.length ? msgs.map(m => JSON.stringify(m)).join(', ') : '-'}`
        ].join('\n');
    }

    // ---------------------------------------------------------------- internals

    private findNewMessage(re: RegExp | string): string | undefined {
        const rx = toRe(re);
        const all = this.messages;
        for (let i = this.checkedMessages; i < all.length; i++) {
            if (rx.test(all[i])) {
                this.checkedMessages = i + 1;
                return all[i];
            }
        }
        return undefined;
    }

    private scriptErrorsSeen = 0;
    private checkScriptErrors() {
        if (!this.failOnScriptError) return;
        const all = this.messages;
        for (let i = this.scriptErrorsSeen; i < all.length; i++) {
            if (all[i].startsWith('script error:')) {
                this.scriptErrorsSeen = all.length;
                throw new HarnessError(`RuneScript error reported to ${this.player.username}:\n  ${all.slice(i).join('\n  ')}`);
            }
        }
        this.scriptErrorsSeen = all.length;
    }

    /**
     * The real client walks with MOVE_OPCLICK right before an op packet on something in the world
     * (docs/flows/move-opclick.md): with the default clientRoutefinder the engine follows the client's
     * route and does not path to a loc itself, so without it an op on a distant loc ends in
     * "I can't reach that!". The route here comes from the engine's route finder (GameMap.ts), the
     * same calls PathingEntity.pathToTarget makes, standing in for the client's.
     */
    private sendOpRoute(route: Uint32Array) {
        if (route.length === 0) return;
        const path = Array.from(route, p => {
            const u = CoordGrid.unpackCoord(p);
            return { x: u.x, z: u.z };
        });
        if (path.length === 1 && path[0].x === this.x && path[0].z === this.z) return;
        this.player.send('MOVE_OPCLICK', ClientGameProt.MOVE_OPCLICK, new MoveClick(path, 0, true));
    }

    private routeToLoc(loc: Loc): Uint32Array {
        const forceapproach = LocType.get(loc.type).forceapproach;
        return findPathToLoc(this.level, this.x, this.z, loc.x, loc.z, this.player.width, loc.width, loc.length, loc.angle, loc.shape, forceapproach);
    }

    private heldSlot(obj: string | number) {
        const id = ids.obj(obj);
        const invId = ids.inv('inv');
        const listener = this.player.invListeners.find(l => l && l.type === invId && l.source !== -1);
        if (!listener) throw new HarnessError('Backpack is not transmitted (inventory tab not set up?)');
        const inv = this.player.getInventory(invId)!;
        for (let slot = 0; slot < inv.capacity; slot++) {
            if (inv.hasAt(slot, id)) return { id, slot, com: listener.com };
        }
        throw new HarnessError(`No ${obj} in the backpack`);
    }
}

function opProt(prefix: string, op: number): ClientGameProt {
    if (op < 1 || op > 5) throw new HarnessError(`op must be 1-5, got ${op}`);
    return (ClientGameProt as unknown as Record<string, ClientGameProt>)[`${prefix}${op}`];
}

function toRe(re: RegExp | string): RegExp {
    return typeof re === 'string' ? new RegExp(escapeRe(re), 'i') : re;
}

function escapeRe(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function convertArg(type: number, a: string | number | boolean | Coord): string | number {
    if (typeof a === 'boolean') return a ? 1 : 0;
    if (typeof a === 'object') {
        const c = parseCoord(a);
        return CoordGrid.packCoord(c.level, c.x, c.z);
    }
    if (typeof a === 'number') return a;
    switch (type) {
        case ScriptVarType.STRING:
            return a;
        case ScriptVarType.OBJ:
        case ScriptVarType.NAMEDOBJ:
            return ids.obj(a);
        case ScriptVarType.NPC:
            return ids.npc(a);
        case ScriptVarType.LOC:
            return ids.loc(a);
        case ScriptVarType.INV:
            return ids.inv(a);
        case ScriptVarType.STAT:
            return ids.stat(a);
        case ScriptVarType.SEQ:
            return ids.seq(a);
        case ScriptVarType.COORD: {
            const c = parseCoord(a);
            return CoordGrid.packCoord(c.level, c.x, c.z);
        }
        default: {
            const n = parseInt(a, 10);
            if (isNaN(n)) throw new HarnessError(`Cannot convert "${a}" for parameter type ${type}`);
            return n;
        }
    }
}

/** Spawn a temporary NPC next to a coord (World.addNpc, as the npc_add command does: NpcOps.ts NPC_ADD). */
export function spawnNpc(type: string | number, at: CoordLike, durationTicks = 500): Npc {
    const c = parseCoord(at);
    const npcType = NpcType.get(ids.npc(type));
    const npc = new Npc(c.level, c.x, c.z, npcType.size, npcType.size, EntityLifeCycle.DESPAWN, World.getNextNid(), npcType.id, npcType.blockwalk);
    World.addNpc(npc, durationTicks);
    return npc;
}
