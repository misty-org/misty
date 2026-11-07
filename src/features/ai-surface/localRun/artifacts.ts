import { agentAccountId } from "@/features/agents/agentAccount";
import { localDocuments } from "@/features/misty/localChats";
import { endProposalRun, publishLocalRunEvent } from "../localRunEvents";
import type { AiArtifact, AiCitation, AiContextReference, AiSelectionSnapshot } from "../types";
import { artifactSpecs } from "./artifactSpecs";

/**
 * Reviewable proposals, in misty.db (`ai_artifact_decisions.go`, `ai_artifact_state.go`,
 * `ai_invocation_runtime_completion.go`). A run that was asked for a proposal hands its answer over as
 * `local.artifact_answer`; this builds the proposal and ends the run, and a person's decision comes
 * back here. Nothing is applied here: the surface that owns the target applies it.
 */

const artifactLifetimeMs = 24 * 3_600_000;
const maxProposalBytes = 256 << 10;
const maxSummary = 500;
const reviewable = "I prepared a reviewable proposal. Nothing has been applied.";

/** What a proposal needs from the request, kept from the moment the run starts. */
export interface ArtifactRequest {
  runId: string;
  account: string;
  requestedKind: string;
  surfaceId: string;
  selection?: AiSelectionSnapshot;
  context: AiContextReference[];
  sources: AiCitation[];
}

export class ArtifactRefused extends Error {
  constructor(
    readonly code: "artifact_not_found" | "artifact_already_decided",
    message: string,
  ) {
    super(message);
  }
}

const requestId = (runId: string) => `request:${runId}`;

export function rememberArtifactRequest(request: ArtifactRequest) {
  return localDocuments.swap(
    request.account,
    "artifact",
    requestId(request.runId),
    null,
    JSON.stringify(request),
  );
}

async function save(account: string, artifact: AiArtifact, expected: string | null) {
  return localDocuments.swap(account, "artifact", artifact.id, expected, JSON.stringify(artifact));
}

async function load(account: string, id: string): Promise<{ raw: string; artifact: AiArtifact }> {
  const raw = await localDocuments.get(account, "artifact", id);
  if (!raw) throw new ArtifactRefused("artifact_not_found", "This draft is no longer here.");
  return { raw, artifact: JSON.parse(raw) as AiArtifact };
}

/** The model's answer as a proposal envelope: its summary and operations, and nothing else. */
export function parseProposal(answer: string): {
  summary: string;
  operations: Record<string, unknown>;
} {
  let text = answer.trim();
  text = text.replace(/^```json/, "").replace(/^```/, "").replace(/```$/, "").trim();
  if (new TextEncoder().encode(text).length > maxProposalBytes)
    throw new Error("artifact proposal is too large");
  const parsed = JSON.parse(text) as Record<string, unknown>;
  if (Object.keys(parsed).some((key) => key !== "summary" && key !== "operations"))
    throw new Error("artifact proposal has unknown fields");
  const operations = parsed.operations;
  if (!operations || typeof operations !== "object" || Array.isArray(operations))
    throw new Error("artifact operations are required");
  const clean =
    typeof parsed.summary === "string" ? parsed.summary.split(/\s+/).filter(Boolean).join(" ") : "";
  const characters = [...clean];
  return {
    summary: characters.length > maxSummary ? `${characters.slice(0, maxSummary).join("")}…` : clean,
    operations: operations as Record<string, unknown>,
  };
}

function targetOf(request: ArtifactRequest): { target: AiArtifact["target"]; revision: unknown } {
  const object = request.selection?.object as Record<string, unknown> | undefined;
  if (object) return { target: object as unknown as AiArtifact["target"], revision: object.revision };
  const reference = request.context[0];
  if (!reference) return { target: undefined, revision: undefined };
  return {
    target: {
      kind: reference.kind,
      id: reference.id,
      ...(reference.spaceId ? { spaceId: reference.spaceId } : {}),
      ...(reference.href ? { href: reference.href } : {}),
    } as unknown as AiArtifact["target"],
    revision: reference.revision,
  };
}

/** Builds the proposal for a run's answer. Throws when the answer can't be one: the run then fails. */
export function buildArtifact(request: ArtifactRequest, answer: string, now: number): AiArtifact {
  const base = {
    id: `artifact_${crypto.randomUUID()}`,
    schemaVersion: 1,
    expiresAt: new Date(now + artifactLifetimeMs).toISOString(),
    state: "proposed",
    invocationId: request.runId,
  };
  const kind =
    request.requestedKind || (request.selection && request.surfaceId.startsWith("notes") ? "text_patch" : "");
  if (kind === "text_patch" && request.selection) {
    const { target, revision } = targetOf(request);
    return {
      ...base,
      kind,
      title: "Review revision",
      summary: "Replace the selected text with Misty's draft.",
      sources: request.sources,
      operations: { replacement: answer, selection: request.selection },
      risk: "draft",
      approvalPolicy: "auto_apply_with_undo",
      idempotencyKey: `artifact:${request.runId}`,
      target,
      baseRevision: revision,
    } as unknown as AiArtifact;
  }
  const spec = artifactSpecs[kind];
  if (!spec) throw new Error("unsupported artifact kind");
  const { summary, operations } = parseProposal(answer);
  const { target, revision } = targetOf(request);
  return {
    ...base,
    kind,
    title: spec.title,
    summary: summary || "Review the exact proposed operations before applying them.",
    sources: request.sources,
    target,
    baseRevision: revision,
    operations,
    risk: spec.risk,
    approvalPolicy: spec.approvalPolicy,
    idempotencyKey: `artifact:${request.runId}:${kind}`,
  } as unknown as AiArtifact;
}

/** The events that end a run whose answer became a proposal. */
export async function finishWithProposal(runId: string, answer: string, account: string) {
  const raw = await localDocuments.get(account, "artifact", requestId(runId));
  const request = raw ? (JSON.parse(raw) as ArtifactRequest) : null;
  const publish = (event: Record<string, unknown>) =>
    publishLocalRunEvent(runId, {
      id: `${runId}:artifact:${String(event.type)}`,
      ...event,
    } as Parameters<typeof publishLocalRunEvent>[1]);
  const endProposal = (event: Record<string, unknown>) =>
    endProposalRun(runId, {
      id: `${runId}:artifact:${String(event.type)}`,
      ...event,
    } as Parameters<typeof publishLocalRunEvent>[1]);
  try {
    if (!request) throw new Error("the proposal's request is gone");
    const artifact = buildArtifact(request, answer, Date.now());
    await save(account, artifact, null);
    const message =
      artifact.kind === "text_patch"
        ? "I prepared a revision."
        : artifact.summary === "Review the exact proposed operations before applying them."
          ? reviewable
          : artifact.summary;
    publish({ type: "assistant.message", text: message, summary: message });
    publish({ type: "artifact.proposed", artifact });
    publish({ type: "approval.required", artifact });
    await endProposal({ type: "invocation.completed", state: "completed" });
  } catch {
    await endProposal({
      type: "invocation.failed",
      state: "failed",
      error: "Misty could not complete this request.",
    }).catch(() => undefined);
  } finally {
    await localDocuments.remove(account, "artifact", requestId(runId)).catch(() => undefined);
  }
}

type Decision = "accept" | "reject" | "refine";

/** A person's answer to a proposal. It's decided once: a second answer is refused. */
export async function decideLocalArtifact(artifactId: string, decision: Decision) {
  const account = agentAccountId();
  for (let attempt = 0; attempt < 8; attempt++) {
    const { raw, artifact } = await load(account, artifactId);
    if (Date.parse(artifact.expiresAt) <= Date.now())
      throw new ArtifactRefused("artifact_not_found", "This draft has expired.");
    if (artifact.state !== "proposed")
      throw new ArtifactRefused("artifact_already_decided", "This draft has already been decided.");
    const next: AiArtifact = { ...artifact, state: decision === "accept" ? "applying" : "rejected" };
    if (!(await save(account, next, raw))) continue;
    return {
      artifact: next,
      applyMode: "client" as const,
      result: decision === "refine" ? { refinement_requested: true } : undefined,
    };
  }
  throw new ArtifactRefused("artifact_already_decided", "This draft has already been decided.");
}

/** What the surface did with an accepted proposal. */
export async function completeLocalArtifact(
  artifactId: string,
  state: "applied" | "failed",
  error = "",
) {
  const account = agentAccountId();
  for (let attempt = 0; attempt < 8; attempt++) {
    const { raw, artifact } = await load(account, artifactId);
    const next = { ...artifact, state, error: error.trim() } as AiArtifact;
    if (!(await save(account, next, raw))) continue;
    if (state === "applied" && artifact.invocationId)
      publishLocalRunEvent(artifact.invocationId, {
        id: `${artifact.invocationId}:effect:${artifact.id}`,
        type: "effect.applied",
        artifactId: artifact.id,
        text: artifact.summary,
      } as unknown as Parameters<typeof publishLocalRunEvent>[1]);
    return { artifact: next };
  }
  throw new ArtifactRefused("artifact_not_found", "This draft is no longer here.");
}
