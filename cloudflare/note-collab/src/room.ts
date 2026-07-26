import { YServer } from "y-partyserver";
import type { Connection, ConnectionContext } from "partyserver";

import { TicketError, verifyTicket, type NoteRole } from "./ticket";

/**
 * One Durable Object per note.
 *
 * The room is the only place with a serialized view of a single note, which is
 * why two things must happen here rather than in the Worker entrypoint:
 * burning a single-use ticket id, and comparing a ticket's ACL version against
 * the newest version this room has seen.
 */

export interface Env {
  NOTE_ROOM: DurableObjectNamespace;
  NOTE_COLLAB_TICKET_PUBLIC_KEY: string;
  NOTE_COLLAB_CONTROL_SECRET: string;
  NOTE_COLLAB_PROJECTION_SECRET: string;
  NOTE_COLLAB_ISSUER: string;
  NOTE_COLLAB_AUDIENCE: string;
  MISTY_INTERNAL_API_BASE: string;
}

/** Per-connection state, kept in memory only. */
interface SocketState {
  userID: string;
  role: NoteRole;
  aclVersion: number;
  noteID: string;
  spaceID: string;
}

const MAX_CONNECTIONS_PER_ROOM = 40;
/** Yjs updates are small; anything larger is not a legitimate edit. */
const MAX_MESSAGE_BYTES = 512 * 1024;
/** Used ticket ids are kept a little past ticket expiry, then swept. */
const JTI_RETENTION_MS = 5 * 60 * 1000;

export class NoteRoom extends YServer<Env> {
  /**
   * Persist shortly after edits stop rather than on every keystroke. A single
   * burst of typing is one write instead of hundreds.
   */
  static override callbackOptions = {
    debounceWait: 2000,
    debounceMaxWait: 10000,
  };

  /** Newest ACL version this room has been told about. */
  private aclVersion = 0;
  private readonly sockets = new WeakMap<Connection, SocketState>();

  /**
   * Authorizes the socket before it joins.
   *
   * Everything here fails closed: any thrown error or non-101 response means
   * the connection is refused, so a bug cannot accidentally admit a client.
   */
  override async onConnect(connection: Connection, ctx: ConnectionContext): Promise<void> {
    const url = new URL(ctx.request.url);
    const token = url.searchParams.get("ticket") ?? "";

    let claims;
    try {
      claims = await verifyTicket(token, {
        publicKeyBase64: this.env.NOTE_COLLAB_TICKET_PUBLIC_KEY,
        issuer: this.env.NOTE_COLLAB_ISSUER,
        audience: this.env.NOTE_COLLAB_AUDIENCE,
        room: this.name,
      });
    } catch (error) {
      this.refuse(connection, error instanceof TicketError ? error.code : "ticket_invalid");
      return;
    }

    // A ticket older than the room's known ACL version is stale by definition:
    // permissions changed after it was minted, so the client must ask the API
    // for a fresh one that reflects the new grant set.
    if (claims.acl_version < this.aclVersion) {
      this.refuse(connection, "ticket_acl_stale");
      return;
    }
    if (claims.acl_version > this.aclVersion) {
      this.aclVersion = claims.acl_version;
      await this.ctx.storage.put("aclVersion", this.aclVersion);
    }

    // Single use. The check and the write are one storage transaction so two
    // simultaneous connections cannot both claim the same ticket.
    if (!(await this.burnTicketID(claims.jti))) {
      this.refuse(connection, "ticket_replayed");
      return;
    }

    if (this.connectionCount() >= MAX_CONNECTIONS_PER_ROOM) {
      this.refuse(connection, "room_full");
      return;
    }

    this.sockets.set(connection, {
      userID: claims.sub,
      role: claims.role,
      aclVersion: claims.acl_version,
      noteID: claims.note_id,
      spaceID: claims.space_id,
    });
    await super.onConnect(connection, ctx);
  }

  /**
   * Viewers receive document state and awareness but may not submit updates.
   * y-partyserver consults this before applying anything to the document.
   */
  override isReadOnly(connection: Connection): boolean {
    const state = this.sockets.get(connection);
    // An unknown socket is treated as read-only rather than trusted.
    if (!state) return true;
    if (state.role === "viewer") return true;
    // A socket that authorized under an older ACL version has been superseded
    // by a permission change and must reconnect before writing again.
    return state.aclVersion < this.aclVersion;
  }

  override async onMessage(connection: Connection, message: ArrayBuffer | string): Promise<void> {
    const size = typeof message === "string" ? message.length : message.byteLength;
    if (size > MAX_MESSAGE_BYTES) {
      this.refuse(connection, "message_too_large");
      return;
    }
    await super.onMessage(connection, message);
  }

  /** Handles authenticated control commands from the Go API. */
  async handleControl(command: string, payload: Record<string, unknown>): Promise<Response> {
    switch (command) {
      case "acl": {
        const version = Number(payload.acl_version);
        if (!Number.isInteger(version) || version < 1) {
          return jsonResponse({ code: "invalid_acl_version" }, 400);
        }
        // Only ever moves forward, so an out-of-order retry of an older
        // command cannot re-admit users who were already revoked.
        if (version > this.aclVersion) {
          this.aclVersion = version;
          await this.ctx.storage.put("aclVersion", version);
        }
        this.disconnectSupersededSockets();
        return jsonResponse({ ok: true, acl_version: this.aclVersion });
      }
      case "disconnect": {
        const userIDs = Array.isArray(payload.user_ids) ? (payload.user_ids as string[]) : null;
        this.disconnectUsers(userIDs);
        return jsonResponse({ ok: true });
      }
      case "purge": {
        // Idempotent: purging an already-empty room succeeds, which is what
        // lets the Go retention worker retry safely.
        this.disconnectUsers(null);
        await this.ctx.storage.deleteAll();
        this.aclVersion = 0;
        return jsonResponse({ ok: true, purged: true });
      }
      default:
        return jsonResponse({ code: "unknown_command" }, 400);
    }
  }

  /** Closes sockets whose authorization predates the current ACL version. */
  private disconnectSupersededSockets(): void {
    for (const connection of this.getConnections()) {
      const state = this.sockets.get(connection);
      if (!state || state.aclVersion < this.aclVersion) {
        this.close(connection, "acl_superseded");
      }
    }
  }

  /** Closes every socket for the listed users, or all sockets when null. */
  private disconnectUsers(userIDs: string[] | null): void {
    const targeted = userIDs === null ? null : new Set(userIDs);
    for (const connection of this.getConnections()) {
      const state = this.sockets.get(connection);
      if (targeted === null || (state && targeted.has(state.userID))) {
        this.close(connection, "access_revoked");
      }
    }
  }

  private connectionCount(): number {
    let count = 0;
    for (const _ of this.getConnections()) count += 1;
    return count;
  }

  private refuse(connection: Connection, code: string): void {
    // 1008 is "policy violation". The code alone is sent; nothing that
    // identifies the note or its members goes over a refused socket.
    try {
      connection.close(1008, code);
    } catch {
      /* already closing */
    }
  }

  private close(connection: Connection, code: string): void {
    try {
      connection.close(1008, code);
    } catch {
      /* already closing */
    }
  }

  /**
   * Records a ticket id if it has not been seen. Returns false on replay.
   *
   * Durable Object storage is serialized per object, so this read-then-write
   * cannot interleave with another connection to the same room.
   */
  private async burnTicketID(jti: string): Promise<boolean> {
    const key = `jti:${jti}`;
    const existing = await this.ctx.storage.get<number>(key);
    if (existing !== undefined) return false;
    const now = Date.now();
    await this.ctx.storage.put(key, now);
    // Opportunistic sweep so used ids do not accumulate forever.
    if (Math.random() < 0.05) await this.sweepTicketIDs(now);
    return true;
  }

  private async sweepTicketIDs(now: number): Promise<void> {
    const entries = await this.ctx.storage.list<number>({ prefix: "jti:", limit: 200 });
    const stale: string[] = [];
    for (const [key, storedAt] of entries) {
      if (now - storedAt > JTI_RETENTION_MS) stale.push(key);
    }
    if (stale.length > 0) await this.ctx.storage.delete(stale);
  }

  override async onStart(): Promise<void> {
    this.aclVersion = (await this.ctx.storage.get<number>("aclVersion")) ?? 0;
    await super.onStart?.();
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
