// A player with a fake in-memory connection.
//
// It is a real NetworkPlayer, so World treats it exactly like a logged-in client
// (isClientConnected() is true: NetworkPlayer.ts isClientConnected), which means:
// - client input is handled in phase 2 (processClientsIn -> decodeIn), by the engine's own
//   packet handlers (ClientGameProtRepository), with their validation rules;
// - phase 10 (processClientsOut) builds player/NPC info for it, so the server's view of
//   "which NPCs this client can see" (rsbuf.hasNpc, checked by OpNpcHandler) is real.
//
// What differs from a real client: inputs are message objects, not bytes (decoders are skipped),
// and server messages are recorded as objects instead of being encoded and sent.
import World from '../../Engine-TS/src/engine/World.js';
import ClientGameProt from '../../Engine-TS/src/network/game/client/ClientGameProt.js';
import ClientGameProtCategory from '../../Engine-TS/src/network/game/client/ClientGameProtCategory.js';
import ClientGameProtRepository from '../../Engine-TS/src/network/game/client/ClientGameProtRepository.js';
import ClientGameMessage from '../../Engine-TS/src/network/game/client/ClientGameMessage.js';
import ServerGameMessage from '../../Engine-TS/src/network/game/server/ServerGameMessage.js';
import NpcInfo from '../../Engine-TS/src/network/game/server/model/NpcInfo.js';
import PlayerInfo from '../../Engine-TS/src/network/game/server/model/PlayerInfo.js';
import { NetworkPlayer } from '../../Engine-TS/src/engine/entity/NetworkPlayer.js';
import Player from '../../Engine-TS/src/engine/entity/Player.js';
import ClientSocket from '../../Engine-TS/src/server/ClientSocket.js';

export class HarnessSocket extends ClientSocket {
    closed = false;

    constructor() {
        super();
        // World.processLogins only adds a connected player to playerLoop when remoteAddress
        // contains '.' or ':' (World.ts processLogins); 'unknown' would leave it out of every phase.
        this.remoteAddress = '127.0.0.1';
    }

    send(src: Uint8Array): void {
        this.totalBytesWritten += src.length;
    }

    close(): void {
        this.closed = true;
    }

    terminate(): void {
        this.closed = true;
    }
}

export type SentInput = { tick: number; prot: string; accepted: boolean };
export type Received = { tick: number; message: ServerGameMessage };

export class TestPlayer extends NetworkPlayer {
    /** Client inputs waiting for the next processClientsIn. */
    pendingInput: {
        name: string;
        prot: ClientGameProt;
        message: ClientGameMessage;
    }[] = [];
    /** Every input handled, and whether its handler accepted it (handler returned true). */
    inputLog: SentInput[] = [];
    /** Every server message written to this player, except per-tick player/NPC info. */
    received: Received[] = [];

    /**
     * Turn a Player that PlayerLoading.load() built (it only builds NetworkPlayer or Player) into a
     * TestPlayer, keeping the same object. Field set-up mirrors the NetworkPlayer constructor.
     */
    static adopt(player: Player): TestPlayer {
        Object.setPrototypeOf(player, TestPlayer.prototype);
        const p = player as TestPlayer;
        const client = new HarnessSocket();
        p.client = client;
        p.session = client.uuid;
        client.player = p;
        p.userLimit = 0;
        p.clientLimit = 0;
        p.restrictedLimit = 0;
        p.userPath = [];
        p.opcalled = false;
        p.pendingInput = [];
        p.inputLog = [];
        p.received = [];
        return p;
    }

    /** Queue a client packet; it is handled in the next tick's processClientsIn. `name` is for logs. */
    send(name: string, prot: ClientGameProt, message: ClientGameMessage) {
        this.pendingInput.push({ name, prot, message });
    }

    // Replaces NetworkPlayer.decodeIn/read: same reset, same "keep-alive" bookkeeping, same
    // per-tick limit on accepted user events (ClientGameProtCategory.USER_EVENT.limit = 5);
    // anything over the limit waits for the next tick, as unread bytes would.
    override decodeIn() {
        this.userPath = [];
        this.opcalled = false;

        this.lastConnected = World.currentTick;
        this.lastResponse = World.currentTick;
        this.userLimit = 0;

        while (this.pendingInput.length > 0 && this.userLimit < ClientGameProtCategory.USER_EVENT.limit) {
            const { name, prot, message } = this.pendingInput.shift()!;
            const handler = ClientGameProtRepository.getHandler(prot);
            const accepted = handler?.handle(message, this) ?? false;
            if (accepted && message.category === ClientGameProtCategory.USER_EVENT) {
                this.userLimit++;
            }
            this.inputLog.push({ tick: World.currentTick, prot: name, accepted });
        }

        return true;
    }

    override writeInner(message: ServerGameMessage): void {
        if (message instanceof PlayerInfo || message instanceof NpcInfo) {
            return;
        }
        this.received.push({ tick: World.currentTick, message });
    }

    override logout() {
        // a real client would get the Logout packet; nothing to do
    }

    override terminate() {
        this.client.terminate();
    }
}
