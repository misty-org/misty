import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

type Listener = (...args: never[]) => void;

class FakeProvider {
  readonly listeners = new Map<string, Set<Listener>>();
  private current = false;
  wsconnected = true;
  readonly sent: Uint8Array[] = [];
  readonly ws = {
    send: vi.fn((data: Uint8Array) => {
      this.sent.push(data);
      // The room answers a sync request on its next turn.
      if (this.answers) setTimeout(() => (this.synced = true), 0);
    }),
  };
  readonly awareness = { setLocalState: vi.fn() };
  readonly sendMessage = vi.fn();
  readonly disconnect = vi.fn();
  readonly destroy = vi.fn();
  answers = true;
  constructor(readonly doc: Y.Doc) {}
  get synced() {
    return this.current;
  }
  set synced(value: boolean) {
    if (value === this.current) return;
    this.current = value;
    this.emit("sync", value);
  }
  on(event: string, listener: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
  }
  off(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener);
  }
  emit(event: string, ...args: unknown[]) {
    for (const listener of [...(this.listeners.get(event) ?? [])])
      (listener as (...a: unknown[]) => void)(...args);
  }
}

const state = vi.hoisted(() => ({
  ticket: vi.fn(),
  providers: [] as unknown[],
  onCreate: undefined as undefined | ((provider: unknown, doc: unknown) => void),
}));

vi.mock("./itemRooms", () => ({
  requestRoomTicket: state.ticket,
  roomParty: (kind: string) => `${kind}-room`,
}));

vi.mock("../journal/notes/createYjsProvider", () => ({
  createYjsProvider: (_ticket: unknown, doc: Y.Doc) => {
    const provider = new FakeProvider(doc);
    state.providers.push(provider);
    const access = { lost: null, subscribe: () => () => undefined, lose: vi.fn(), retry: vi.fn() };
    state.onCreate?.(provider, doc);
    return { provider, access };
  },
}));

import { materializeNoteMarkdown, ToolSessionError, withToolDoc } from "./toolSession";

const editorTicket = {
  ticket: "t",
  room: "r",
  url: "wss://collab.test",
  role: "editor",
  expires_at: "",
};

function lastProvider(): FakeProvider {
  return state.providers[state.providers.length - 1] as FakeProvider;
}

describe("withToolDoc", () => {
  beforeEach(() => {
    state.ticket.mockReset();
    state.ticket.mockResolvedValue(editorTicket);
    state.providers.length = 0;
    state.onCreate = (provider) => {
      // The room's content arrives just after joining.
      setTimeout(() => ((provider as FakeProvider).synced = true), 0);
    };
  });
  afterEach(() => {
    state.onCreate = undefined;
  });

  it("joins, runs an async change, waits for the room to have it, then leaves", async () => {
    const order: string[] = [];
    const result = await withToolDoc("deck", "space-1", "deck-1", async (doc) => {
      order.push("fn");
      await Promise.resolve();
      doc.getMap("deck:meta").set("title", "Pitch");
      return "done";
    });
    const provider = lastProvider();
    expect(result).toBe("done");
    expect(state.ticket).toHaveBeenCalledWith("deck", "space-1", "deck-1");
    expect(order).toEqual(["fn"]);
    // A sync request (message type 0, sync step 1) asked the room after the change.
    expect(provider.ws.send).toHaveBeenCalledTimes(1);
    expect(provider.sent[0]?.[0]).toBe(0);
    expect(provider.sent[0]?.[1]).toBe(0);
    expect(provider.awareness.setLocalState).toHaveBeenCalledWith(null);
    expect(provider.disconnect).toHaveBeenCalled();
    expect(provider.destroy).toHaveBeenCalled();
  });

  it("doesn't wait on the room when nothing changed", async () => {
    await withToolDoc("workbook", "space-1", "wb-1", (doc) => doc.getMap("wb:meta").get("title"));
    expect(lastProvider().ws.send).not.toHaveBeenCalled();
    expect(lastProvider().disconnect).toHaveBeenCalled();
  });

  it("refuses to change an item the ticket only lets this person view", async () => {
    state.ticket.mockResolvedValue({ ...editorTicket, role: "viewer" });
    await expect(withToolDoc("drawing", "s", "d", () => undefined)).rejects.toMatchObject({
      code: "read_only",
    });
    expect(state.providers).toHaveLength(0);
  });

  it("times out joining with a clear error, and leaves", async () => {
    state.onCreate = undefined;
    const error = await withToolDoc("note", "s", "n", () => undefined, { timeoutMs: 10 }).catch(
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(ToolSessionError);
    expect((error as ToolSessionError).code).toBe("sync_timeout");
    expect(lastProvider().disconnect).toHaveBeenCalled();
  });

  it("times out when the room never confirms the change", async () => {
    state.onCreate = (provider) => {
      (provider as FakeProvider).answers = false;
      setTimeout(() => ((provider as FakeProvider).synced = true), 0);
    };
    await expect(
      withToolDoc("deck", "s", "k", (doc) => doc.getMap("deck:meta").set("title", "x"), {
        timeoutMs: 20,
      }),
    ).rejects.toMatchObject({ code: "ack_timeout" });
  });

  it("claims a note's pending markdown like an editor, then writes it in whole", async () => {
    state.onCreate = (provider, doc) => {
      const fake = provider as FakeProvider;
      const metadata = (doc as Y.Doc).getMap("misty:document");
      metadata.set("pending_version", 2);
      metadata.set("pending_markdown", "# Hello\n\nFrom an agent");
      fake.sendMessage.mockImplementation((message: string) => {
        const claim = JSON.parse(message) as { version: number };
        setTimeout(() =>
          fake.emit(
            "custom-message",
            JSON.stringify({
              type: "pending_markdown_lease",
              version: claim.version,
              granted: true,
            }),
          ),
        );
      });
      setTimeout(() => (fake.synced = true), 0);
    };
    let written: Y.Doc | null = null;
    await withToolDoc("note", "space-1", "note-1", (doc) => {
      written = doc;
      materializeNoteMarkdown(doc, "# Hello\n\nFrom an agent");
      return {
        fragment: doc.getXmlFragment("tiptap").length,
        markdown: doc.getText("misty:markdown").toString(),
        applied: doc.getMap("misty:document").get("applied_version"),
        schema: doc.getMap("misty:document").get("schema"),
      };
    }).then((result) => {
      expect(result.fragment).toBeGreaterThan(0);
      expect(result.markdown).toContain("# Hello");
      expect(result.markdown).toContain("From an agent");
      expect(result.applied).toBe(2);
      expect(result.schema).toBe("tiptap-v1");
    });
    expect(written).not.toBeNull();
    expect(lastProvider().sendMessage).toHaveBeenCalledWith(
      JSON.stringify({ type: "claim_pending_markdown", version: 2 }),
    );
    expect(lastProvider().ws.send).toHaveBeenCalled();
  });
});

describe("materializeNoteMarkdown", () => {
  it("changes nothing when the doc already holds that content", () => {
    const doc = new Y.Doc();
    materializeNoteMarkdown(doc, "Some **text**\n\n::embed{kind=board-frame id=d1 part=f1}");
    const fragmentBefore = doc.getXmlFragment("tiptap").toJSON();
    materializeNoteMarkdown(doc, "Some **text**\n\n::embed{kind=board-frame id=d1 part=f1}");
    expect(doc.getXmlFragment("tiptap").toJSON()).toEqual(fragmentBefore);
    expect(doc.getText("misty:markdown").toString()).toContain(
      "::embed{kind=board-frame id=d1 part=f1}",
    );
  });
});
