import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CompanionConversation } from "./companionConversation";

const mocks = vi.hoisted(() => ({
  ticket: vi.fn(),
  append: vi.fn(),
  close: vi.fn(),
  tool: vi.fn(),
}));
vi.mock("@/api/agents/api", () => ({ agentsApi: { realtimeVoiceTicket: mocks.ticket } }));
vi.mock("@/api/deployment/api", () => ({ resolveApiBase: async () => "https://fixture.test/v1" }));
vi.mock("../store/useAgentsStore", () => ({
  agentsDeviceSnapshot: async () => ({ device: { id: "local", status: "active" } }),
}));
vi.mock("../store/useAgentDeviceStore", () => ({
  ensureServerAgentDevice: async () => ({ id: "server" }),
}));
vi.mock("./companionVoicePlayback", () => ({
  CompanionVoicePlayback: class {
    constructor(
      private playing: () => void,
      private done: () => void,
    ) {}
    start = async () => {};
    append(value: string) {
      mocks.append(value);
      this.playing();
    }
    finish() {
      this.done();
    }
    close = mocks.close;
    heard = () => ({ itemId: "reply", audioEndMs: 420 });
  },
}));
class Socket {
  static OPEN = 1;
  static all: Socket[] = [];
  readyState = 1;
  bufferedAmount = 0;
  onmessage?: (e: { data: string }) => void;
  onerror?: () => void;
  onclose?: () => void;
  sent: Record<string, unknown>[] = [];
  constructor(readonly url: URL) {
    Socket.all.push(this);
  }
  send(s: string) {
    this.sent.push(JSON.parse(s));
  }
  receive(e: object) {
    this.onmessage?.({ data: JSON.stringify(e) });
  }
  close() {
    this.readyState = 3;
  }
}
let sessions: CompanionConversation[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  Socket.all = [];
  vi.stubGlobal("WebSocket", Socket);
  mocks.ticket.mockResolvedValue({ ticket: "one" });
  mocks.tool.mockResolvedValue("task");
});
afterEach(() => {
  sessions.forEach((s) => s.close());
  sessions = [];
  vi.unstubAllGlobals();
});
const tick = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};
async function fixture() {
  const onError = vi.fn(),
    onDone = vi.fn(),
    assertCurrent = vi.fn();
  const s = new CompanionConversation({
    conversation: async () => "conversation",
    assertCurrent,
    onPlaying: vi.fn(),
    onDone,
    onTranscript: vi.fn(),
    onError,
    onExpired: vi.fn(),
    tool: mocks.tool,
  });
  sessions.push(s);
  await tick();
  const socket = Socket.all[0];
  socket.receive({ type: "ready" });
  s.begin();
  await tick();
  socket.receive({ type: "turn.ready" });
  await tick();
  return { s, socket, onError, onDone, assertCurrent };
}
it("commits directly, streams one reply and reuses the authenticated socket", async () => {
  const { s, socket } = await fixture();
  s.append(0, "AAAAAA==");
  await tick();
  const first = s.commit();
  await tick();
  expect(socket.sent.some((e) => e.type === "audio.commit")).toBe(true);
  socket.receive({ type: "audio", audio: "AAAAAA==", itemId: "reply" });
  socket.receive({ type: "audio.done" });
  await tick();
  expect(socket.sent.some((e) => e.type === "playback.done")).toBe(true);
  socket.receive({ type: "turn.done", id: "one", prompt: "Hi", reply: "Hello" });
  await first;
  s.begin();
  await tick();
  socket.receive({ type: "turn.ready" });
  await tick();
  expect(Socket.all).toHaveLength(1);
  expect(mocks.ticket).toHaveBeenCalledOnce();
  expect(mocks.tool).not.toHaveBeenCalled();
});
it("stops buffered audio immediately and waits for cancellation before a new recording", async () => {
  const { s, socket } = await fixture();
  void s.commit("Hi");
  await tick();
  socket.receive({ type: "audio", audio: "AAAAAA==", itemId: "reply" });
  await tick();
  s.begin();
  s.append(0, "AAAAAA==");
  await tick();
  expect(socket.sent.filter((e) => e.type === "turn.begin")).toHaveLength(1);
  expect(socket.sent).toContainEqual({ type: "turn.cancel", itemId: "reply", audioEndMs: 420 });
  socket.receive({ type: "audio", audio: "late", itemId: "reply" });
  await tick();
  expect(mocks.append).not.toHaveBeenCalledWith("late");
  socket.receive({
    type: "turn.done",
    id: "one",
    prompt: "Hi",
    reply: "Interrupted",
    interrupted: true,
  });
  await tick();
  expect(socket.sent.filter((e) => e.type === "turn.begin")).toHaveLength(2);
});
it("deduplicates tool calls and never reconnects or replays after a transport failure", async () => {
  const { s, socket, onError } = await fixture();
  void s.commit("Organize").catch(() => {});
  await tick();
  const call = {
    type: "tool.call",
    name: "start_task",
    callId: "one",
    key: "stable",
    instruction: "Organize",
    invocationId: "",
  };
  socket.receive(call);
  await tick();
  expect(mocks.tool).toHaveBeenCalledOnce();
  socket.receive(call);
  await tick();
  expect(onError).toHaveBeenCalledOnce();
  expect(mocks.tool).toHaveBeenCalledOnce();
  expect(Socket.all).toHaveLength(1);
});
it("does not return late action receipts into a switched conversation", async () => {
  let resolve!: (s: string) => void;
  mocks.tool.mockImplementation(
    () =>
      new Promise<string>((yes) => {
        resolve = yes;
      }),
  );
  const { s, socket } = await fixture();
  void s.commit("Work").catch(() => {});
  await tick();
  socket.receive({
    type: "tool.call",
    name: "start_task",
    callId: "one",
    key: "stable",
    instruction: "Work",
    invocationId: "",
  });
  s.close();
  resolve("task");
  await tick();
  expect(socket.sent.some((e) => e.type === "tool.result")).toBe(false);
});
it("guards account and conversation ownership on every incoming event", async () => {
  const { socket, onError, assertCurrent } = await fixture();
  assertCurrent.mockImplementation(() => {
    throw new Error("Account changed");
  });
  socket.receive({ type: "audio", audio: "AAAAAA==" });
  expect(onError).toHaveBeenCalledOnce();
  expect(mocks.append).not.toHaveBeenCalled();
});

it("cancels a rapid press released before connection setup without opening an input turn", async () => {
  const onError = vi.fn();
  const s = new CompanionConversation({
    conversation: async () => "conversation",
    assertCurrent: () => {},
    onPlaying: vi.fn(),
    onDone: vi.fn(),
    onTranscript: vi.fn(),
    onError,
    onExpired: vi.fn(),
    tool: mocks.tool,
  });
  sessions.push(s);
  s.begin();
  await s.interrupt();
  await tick();
  Socket.all[0].receive({ type: "ready" });
  await tick();
  expect(Socket.all[0].sent.some((e) => e.type === "turn.begin")).toBe(false);
  expect(onError).not.toHaveBeenCalled();
});

it("does not deliver an old tool receipt to a newer turn on the same connection", async () => {
  let resolve!: (id: string) => void;
  mocks.tool.mockImplementation(
    () =>
      new Promise<string>((yes) => {
        resolve = yes;
      }),
  );
  const { s, socket } = await fixture();
  void s.commit("Work");
  await tick();
  socket.receive({
    type: "tool.call",
    name: "start_task",
    callId: "old",
    key: "stable",
    instruction: "Work",
    invocationId: "",
  });
  s.begin();
  socket.receive({
    type: "turn.done",
    id: "old-turn",
    prompt: "Work",
    reply: "Interrupted",
    interrupted: true,
  });
  await tick();
  socket.receive({ type: "turn.ready" });
  await tick();
  resolve("admitted");
  await tick();
  expect(socket.sent.some((e) => e.type === "tool.result")).toBe(false);
});

it("acknowledges typed input before speech completes so the composer can clear", async () => {
  const { s, socket, onDone } = await fixture();
  const canceled = s.interrupt();
  socket.receive({ type: "turn.done", id: "empty", prompt: "", reply: "", interrupted: true });
  await canceled;
  const accepted = vi.fn();
  const pending = s.submitText("Can you see my screen?").then(accepted);
  await tick();
  socket.receive({ type: "turn.ready" });
  await tick();
  expect(socket.sent).toContainEqual({ type: "text.commit", text: "Can you see my screen?" });
  expect(accepted).not.toHaveBeenCalled();
  const finished = onDone.mock.calls.length;
  socket.receive({ type: "transcript", id: "screen", text: "Can you see my screen?" });
  await pending;
  expect(accepted).toHaveBeenCalledOnce();
  expect(onDone).toHaveBeenCalledTimes(finished);
  socket.receive({
    type: "turn.done",
    id: "screen",
    prompt: "Can you see my screen?",
    reply: "I can take a look.",
  });
  expect(onDone).toHaveBeenCalledTimes(finished + 1);
});
