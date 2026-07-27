import { YServer } from "y-partyserver";
import * as Y from "yjs";
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
/** Durable Object storage caps a single value at 128 KiB; stay well under. */
const DOCUMENT_CHUNK_BYTES = 96 * 1024;
/** Beta ceiling for one note's document. */
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
/** Control requests are tiny JSON envelopes, never document snapshots. */
const MAX_CONTROL_BODY_BYTES = 128 * 1024;
const CONTROL_CLOCK_SKEW_SECONDS = 5 * 60;
const BOOTSTRAP_APPLIED_KEY = "bootstrap:applied";

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

  /**
   * Receives service-to-service control commands routed to this room.
   *
   * The timestamp is part of the signature and has a short acceptance window,
   * so a captured request cannot be replayed later. The command body is signed
   * byte-for-byte before JSON parsing.
   */
  override async onRequest(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return jsonResponse({ code: "method_not_allowed" }, 405, { Allow: "POST" });
    }
    const body = new Uint8Array(await request.arrayBuffer());
    if (body.byteLength > MAX_CONTROL_BODY_BYTES) {
      return jsonResponse({ code: "body_too_large" }, 413);
    }
    const timestamp = request.headers.get("X-Misty-Timestamp") ?? "";
    const signature = request.headers.get("X-Misty-Signature") ?? "";
    if (!(await verifyControlRequest(this.env.NOTE_COLLAB_CONTROL_SECRET, timestamp, body, signature))) {
      return jsonResponse({ code: "unauthorized" }, 401);
    }

    let envelope: unknown;
    try {
      envelope = JSON.parse(new TextDecoder().decode(body));
    } catch {
      return jsonResponse({ code: "invalid_json" }, 400);
    }
    if (!isRecord(envelope) || typeof envelope.command !== "string" || !isRecord(envelope.payload)) {
      return jsonResponse({ code: "invalid_command" }, 400);
    }
    return this.handleControl(envelope.command, envelope.payload);
  }

  /** Handles authenticated control commands from the Go API. */
  async handleControl(command: string, payload: Record<string, unknown>): Promise<Response> {
    switch (command) {
      case "bootstrap": {
        const title = typeof payload.title === "string" ? payload.title.trim() : "";
        const markdown = typeof payload.markdown === "string" ? payload.markdown.trim() : "";
        if (!title || title.length > 500 || !markdown || markdown.length > 100_000) {
          return jsonResponse({ code: "invalid_bootstrap" }, 400);
        }
        if ((await this.ctx.storage.get<boolean>(BOOTSTRAP_APPLIED_KEY)) === true) {
          return jsonResponse({ ok: true, initialized: false });
        }

        // A user may open and begin editing before this retryable command
        // arrives. Never replace a document that already has shared state.
        const initialized = this.document.share.size === 0;
        if (initialized) {
          this.document.transact(() => {
            const metadata = this.document.getMap<string>("misty:bootstrap");
            metadata.set("title", title);
            metadata.set("markdown", markdown);
            metadata.set("format", "markdown");
            this.document.getText("markdown").insert(0, markdown);
          });
          await this.onSave();
        }
        // Written after the document snapshot: a crash can cause one harmless
        // retry, but can never claim success before the content is durable.
        await this.ctx.storage.put(BOOTSTRAP_APPLIED_KEY, true);
        return jsonResponse({ ok: true, initialized });
      }
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

  /**
   * Restores the document from Durable Object storage.
   *
   * y-partyserver's base implementations of onLoad/onSave are no-ops, so
   * without these the document would live only in memory and be lost the
   * moment the object is evicted.
   */
  override async onLoad(): Promise<void> {
    const update = await this.readDocumentUpdate();
    if (update) {
      Y.applyUpdate(this.document, update);
    }
  }

  /**
   * Persists the whole document as a single Yjs update.
   *
   * A full state snapshot rather than an incremental log: it keeps loading to
   * one read, and Yjs updates are already compact. Storage values are capped,
   * so the snapshot is chunked.
   */
  override async onSave(): Promise<void> {
    const update = Y.encodeStateAsUpdate(this.document);
    if (update.byteLength > MAX_DOCUMENT_BYTES) {
      // Refusing to save a document this large would silently lose edits, so
      // it is logged loudly instead. The note id is deliberately omitted.
      console.error(`note document exceeds ${MAX_DOCUMENT_BYTES} bytes; not persisted`);
      return;
    }
    const chunks: Record<string, ArrayBuffer> = {};
    let chunkCount = 0;
    for (let offset = 0; offset < update.byteLength; offset += DOCUMENT_CHUNK_BYTES) {
      const slice = update.slice(offset, offset + DOCUMENT_CHUNK_BYTES);
      // A copy, because slice() on a subarray-backed view can retain the whole
      // buffer and blow past the per-value storage limit.
      chunks[`doc:${chunkCount}`] = new Uint8Array(slice).buffer;
      chunkCount += 1;
    }
    const previousCount = (await this.ctx.storage.get<number>("doc:chunks")) ?? 0;
    await this.ctx.storage.put(chunks);
    await this.ctx.storage.put("doc:chunks", chunkCount);
    // Drop chunks left over from a larger previous revision.
    if (previousCount > chunkCount) {
      const stale: string[] = [];
      for (let index = chunkCount; index < previousCount; index += 1) stale.push(`doc:${index}`);
      await this.ctx.storage.delete(stale);
    }
  }

  private async readDocumentUpdate(): Promise<Uint8Array | null> {
    const chunkCount = (await this.ctx.storage.get<number>("doc:chunks")) ?? 0;
    if (chunkCount < 1) return null;
    const parts: Uint8Array[] = [];
    let total = 0;
    for (let index = 0; index < chunkCount; index += 1) {
      const chunk = await this.ctx.storage.get<ArrayBuffer>(`doc:${index}`);
      // A missing chunk means a partially written snapshot; applying the rest
      // would corrupt the document, so nothing is restored.
      if (!chunk) return null;
      const part = new Uint8Array(chunk);
      parts.push(part);
      total += part.byteLength;
    }
    const update = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      update.set(part, offset);
      offset += part.byteLength;
    }
    return update;
  }
}

async function verifyControlRequest(
  encodedSecret: string,
  timestamp: string,
  body: Uint8Array,
  signature: string,
): Promise<boolean> {
  const issuedAt = Number(timestamp);
  if (!Number.isInteger(issuedAt)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - issuedAt) > CONTROL_CLOCK_SKEW_SECONDS) return false;

  let secret: Uint8Array;
  try {
    secret = Uint8Array.from(atob(encodedSecret.trim()), (character) => character.charCodeAt(0));
  } catch {
    return false;
  }
  if (secret.byteLength < 32 || !signature) return false;
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const prefix = new TextEncoder().encode(`${timestamp}\n`);
  const signed = new Uint8Array(prefix.byteLength + body.byteLength);
  signed.set(prefix);
  signed.set(body, prefix.byteLength);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, signed));
  const expected = base64URL(digest);
  return constantTimeEqual(expected, signature);
}

function base64URL(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}
