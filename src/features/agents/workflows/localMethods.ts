import type { AgentMethod, AgentMethodDefinition, SaveAgentMethod } from "@/api/ai/agent-methods";
import { localDocuments } from "@/features/misty/localChats";
import { changeDocument, RunStateError } from "../localTools/runState/documents";
import { validMethodDefinition } from "./methodDefinition";
import { announceWorkflowChange } from "./workflowChanges";

/**
 * Saved workflows, templates and skills, each one document in misty.db on this computer. The rules are
 * the server's (`agent_methods.go`, `agent_method_lessons.go`): every save is a new immutable version
 * and a stale editor is refused. Two owners stay apart: the person's definition, and the steps the
 * agent learned from running it, which never change that definition.
 */

interface MethodVersion {
  id: string;
  version: number;
  definition: AgentMethodDefinition;
  source_invocation_id?: string;
}

interface MethodLesson {
  version: number;
  steps: string;
  source_run_id?: string;
}

export interface LocalMethod extends AgentMethod {
  space_id: string;
  versions: MethodVersion[];
  lessons: MethodLesson[];
}

const kind = "workflow_method";
const maxMethods = 200;
const maxSkills = 8;
/** How many versions of its learned steps a workflow keeps, as the server does. */
const lessonsKept = 10;
/** A run pins the version it started on, so old ones matter briefly; this bounds the document. */
const versionsKept = 20;
const maxLessonBytes = 4000;

function parse(document: string): LocalMethod | null {
  try {
    return JSON.parse(document) as LocalMethod;
  } catch {
    return null;
  }
}

/** Every method on this computer for the account, newest change first. */
export async function allMethods(account: string): Promise<LocalMethod[]> {
  if (!localDocuments.available() || !account) return [];
  const documents = await localDocuments.list(account, kind);
  return documents
    .flatMap((document) => parse(document) ?? [])
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
}

/** An agent's methods in one Space; empty is the personal Space. */
export async function methodsOf(
  account: string,
  spaceId: string,
  agentId: string,
): Promise<LocalMethod[]> {
  return (await allMethods(account))
    .filter((method) => method.space_id === spaceId && method.agent_id === agentId)
    .slice(0, maxMethods);
}

export async function methodById(account: string, id: string): Promise<LocalMethod | null> {
  if (!localDocuments.available() || !account || !id) return null;
  const document = await localDocuments.get(account, kind, id);
  return document === null ? null : parse(document);
}

/** A method as the app and tools see it, without its history. */
export function publicMethod(method: LocalMethod): AgentMethod {
  const { versions: _versions, lessons: _lessons, ...rest } = method;
  return rest;
}

/** A method at one of its versions, or null when it's gone. */
export function methodAtVersion(methods: LocalMethod[], versionId: string): AgentMethod | null {
  for (const method of methods) {
    const version = method.versions.find((item) => item.id === versionId);
    if (version)
      return {
        ...publicMethod(method),
        version: version.version,
        version_id: version.id,
        definition: version.definition,
      };
  }
  return null;
}

/** Saves a new version, or a new method when `input.id` is absent. */
export async function saveMethod(
  account: string,
  input: SaveAgentMethod & { space_id?: string },
): Promise<LocalMethod> {
  if (!localDocuments.available() || !account)
    throw new RunStateError("invalid", "Workflows are kept in the Misty app.");
  const { definition } = input;
  if (!validMethodDefinition(definition)) throw new RunStateError("invalid");
  if (!["workflow", "template", "skill"].includes(input.kind)) throw new RunStateError("invalid");
  if (input.kind === "skill" && (definition.inputs.length > 0 || definition.target !== "cloud"))
    throw new RunStateError("invalid");
  const all = await allMethods(account);
  const existing = input.id ? all.find((method) => method.id === input.id) : undefined;
  if (input.id && !existing) throw new RunStateError("not_found");
  // A workflow stays in the Space it was saved in.
  if (existing && input.space_id && input.space_id !== existing.space_id)
    throw new RunStateError("not_found");
  const spaceId = existing?.space_id ?? input.space_id ?? "";
  if (input.kind === "skill" && input.enabled) {
    const others = all.filter(
      (method) =>
        method.space_id === spaceId &&
        method.agent_id === input.agent_id &&
        method.kind === "skill" &&
        method.enabled &&
        method.id !== input.id,
    );
    if (others.length >= maxSkills) throw new RunStateError("conflict");
  }
  const now = new Date().toISOString();
  const versionId = `method_version_${crypto.randomUUID()}`;
  const source = input.source_invocation_id || undefined;
  if (!existing) {
    if (all.length >= maxMethods) throw new RunStateError("conflict");
    const method: LocalMethod = {
      id: `method_${crypto.randomUUID()}`,
      space_id: spaceId,
      agent_id: input.agent_id,
      kind: input.kind,
      enabled: input.enabled,
      version: 1,
      version_id: versionId,
      definition,
      ...(source ? { source_invocation_id: source } : {}),
      updated_at: now,
      versions: [{ id: versionId, version: 1, definition, source_invocation_id: source }],
      lessons: [],
    };
    await localDocuments.swap(account, kind, method.id, null, JSON.stringify(method));
    announceWorkflowChange();
    return method;
  }
  const saved = await changeDocument<LocalMethod | null, LocalMethod>(
    account,
    kind,
    existing.id,
    () => null,
    (current) => {
      if (!current) throw new RunStateError("not_found");
      if (
        current.version !== (input.expected_version ?? 0) ||
        current.agent_id !== input.agent_id ||
        current.kind !== input.kind
      )
        throw new RunStateError("conflict");
      const version = current.version + 1;
      const next: LocalMethod = {
        ...current,
        enabled: input.enabled,
        version,
        version_id: versionId,
        definition,
        source_invocation_id: source,
        updated_at: now,
        versions: [
          ...current.versions,
          { id: versionId, version, definition, source_invocation_id: source },
        ].slice(-versionsKept),
      };
      return { next, result: next };
    },
  );
  announceWorkflowChange();
  return saved;
}

/** Saves a new version of a workflow's learned steps and returns it. */
export async function addLesson(
  account: string,
  methodId: string,
  steps: string,
  runId: string,
): Promise<MethodLesson> {
  const text = steps.trim();
  if (!text || new TextEncoder().encode(text).length > maxLessonBytes)
    throw new RunStateError("invalid");
  const lesson = await changeDocument<LocalMethod | null, MethodLesson>(
    account,
    kind,
    methodId,
    () => null,
    (current) => {
      if (!current) throw new RunStateError("not_found");
      const version = Math.max(0, ...current.lessons.map((item) => item.version)) + 1;
      const added: MethodLesson = { version, steps: text, source_run_id: runId };
      return {
        next: {
          ...current,
          lessons: [...current.lessons, added].filter(
            (item) => item.version > version - lessonsKept,
          ),
        },
        result: added,
      };
    },
  );
  return lesson;
}

/** A workflow's newest learned steps, or null. */
export function latestLesson(method: LocalMethod): MethodLesson | null {
  return method.lessons.reduce<MethodLesson | null>(
    (latest, lesson) => (!latest || lesson.version > latest.version ? lesson : latest),
    null,
  );
}
