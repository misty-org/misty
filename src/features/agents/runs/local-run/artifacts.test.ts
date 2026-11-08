import type * as Actual1 from "@/shared/platform/tauri";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => {
  const { fakeInvoke } = await import("@/features/agents/tools/run-state/fakeMistyDb.test-support");
  return { invoke: fakeInvoke };
});
vi.mock("@/shared/platform/tauri", async (actual) => ({
  ...(await actual<typeof Actual1>()),
  hasTauriInternals: () => true,
}));
vi.mock("@/features/agents/personal/agentAccount", () => ({ agentAccountId: () => "me" }));
const published = vi.hoisted(() => [] as { type: string; [key: string]: unknown }[]);
vi.mock("./localRunEvents", () => ({
  publishLocalRunEvent: (_run: string, event: { type: string }) => published.push(event),
  endProposalRun: async (_run: string, event: { type: string }) => void published.push(event),
}));

import { rows } from "@/features/agents/tools/run-state/fakeMistyDb.test-support";
import type { AiSelectionSnapshot } from "../invocations/invocationTypes";
import { inferredArtifactKind } from "./artifactSpecs";
import {
  ArtifactRefused,
  buildArtifact,
  completeLocalArtifact,
  decideLocalArtifact,
  finishWithProposal,
  parseProposal,
  rememberArtifactRequest,
  type ArtifactRequest,
} from "./artifacts";

const selection = {
  kind: "text",
  content: "old",
  object: { kind: "note", id: "n", revision: 3 },
  contentHash: "h",
} as AiSelectionSnapshot;

const request = (over: Partial<ArtifactRequest> = {}): ArtifactRequest => ({
  runId: "run",
  account: "me",
  requestedKind: "text_patch",
  surfaceId: "notes",
  selection,
  context: [],
  sources: [],
  ...over,
});

beforeEach(() => {
  rows.clear();
  published.length = 0;
});

describe("which proposal a turn asks for", () => {
  it("goes by the surface and its words", () => {
    expect(inferredArtifactKind("notes", "Please rewrite this", true)).toBe("text_patch");
    expect(inferredArtifactKind("notes", "Please rewrite this", false)).toBe("");
    expect(inferredArtifactKind("drawings", "draw a diagram", false)).toBe("drawing_patch");
    expect(inferredArtifactKind("global", "rewrite everything", true)).toBe("");
  });
});

describe("a proposal", () => {
  it("holds a revision against the selection it replaces", () => {
    const artifact = buildArtifact(request(), "new text", 0);
    expect(artifact).toMatchObject({
      kind: "text_patch",
      risk: "draft",
      approvalPolicy: "auto_apply_with_undo",
      state: "proposed",
      idempotencyKey: "artifact:run",
      baseRevision: 3,
      operations: { replacement: "new text" },
    });
  });

  it("reads a structured answer and refuses anything else", () => {
    expect(parseProposal('```json\n{"summary":" a  b ","operations":{"x":1}}\n```')).toEqual({
      summary: "a b",
      operations: { x: 1 },
    });
    expect(() => parseProposal('{"summary":"a"}')).toThrow("operations are required");
    expect(() => parseProposal('{"operations":{},"extra":1}')).toThrow("unknown fields");
    expect(() => parseProposal("not json")).toThrow();
  });

  it("ends the run as it's published", async () => {
    await rememberArtifactRequest(request());
    await finishWithProposal("run", "new text", "me");
    expect(published.map((event) => event.type)).toEqual([
      "assistant.message",
      "artifact.proposed",
      "approval.required",
      "invocation.completed",
    ]);
    expect(published[0]!.text).toBe("I prepared a revision.");
  });

  it("fails the run when the answer can't be one", async () => {
    await rememberArtifactRequest(
      request({ requestedKind: "drawing_patch", selection: undefined }),
    );
    await finishWithProposal("run", "no json here", "me");
    expect(published.map((event) => event.type)).toEqual(["invocation.failed"]);
  });
});

describe("a decision", () => {
  const proposed = async () => {
    await rememberArtifactRequest(request());
    await finishWithProposal("run", "new text", "me");
    return (
      published.find((event) => event.type === "artifact.proposed")!.artifact as { id: string }
    ).id;
  };

  it("is made once", async () => {
    const id = await proposed();
    await expect(decideLocalArtifact(id, "accept")).resolves.toMatchObject({
      applyMode: "client",
      artifact: { state: "applying" },
    });
    await expect(decideLocalArtifact(id, "reject")).rejects.toBeInstanceOf(ArtifactRefused);
  });

  it("tells the run when it's applied", async () => {
    const id = await proposed();
    await decideLocalArtifact(id, "accept");
    await completeLocalArtifact(id, "applied");
    expect(published[published.length - 1]).toMatchObject({
      type: "effect.applied",
      artifactId: id,
    });
  });

  it("refuses a draft that's gone", async () => {
    await expect(decideLocalArtifact("nope", "accept")).rejects.toMatchObject({
      code: "artifact_not_found",
    });
  });
});
