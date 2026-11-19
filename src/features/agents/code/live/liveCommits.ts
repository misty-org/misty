import { Chunk } from "@codemirror/merge";
import { Text } from "@codemirror/state";
import * as Y from "yjs";
import type { PlannedCommit, PlannedFile } from "./liveApi";
import { liveApi } from "./liveApi";
import { writerOf, type LiveRoom } from "./liveRoom";
import { itemText, lineCount } from "./liveText";
import { mainAuthor, type LiveJoin, type LivePerson } from "./liveTypes";

/**
 * One commit per person from the session's final text against the base commit. Each file's
 * changes are split into hunks (`@codemirror/merge`'s chunks); the text itself says who wrote
 * every character in a hunk and who deleted what was there, through the doc's user data. A hunk
 * belongs to its one person (an agent's work is its owner's); a hunk several people touched goes
 * into one shared commit, with `Co-authored-by` for those people only. Main's own lines, from a
 * merge that conflicted earlier, belong to whoever ends the session: merging main again brings
 * the same lines, so they merge cleanly.
 */

/** Who a commit is for: a person's key, or the shared commit. */
type Group = string;
const shared: Group = "shared";

interface FilePlan {
  path: string;
  base: string;
  /** Null when the file didn't exist at the base commit. */
  existed: boolean;
  final: string;
  chunks: readonly Chunk[];
  groups: Group[];
  /** Everyone each hunk touched, by person key. */
  touched: Array<Set<string>>;
}

export interface CommitPreview {
  /** The person's key, or "shared". */
  group: string;
  names: string[];
  paths: string[];
  plus: number;
  minus: number;
}

export interface CommitPlan {
  commits: PlannedCommit[];
  preview: CommitPreview[];
  /** Files main conflicted in earlier, as the session settled them, for the next merge. */
  resolved: PlannedFile[];
}

/** The person an author key's work belongs to. */
function ownerOf(key: string): string {
  if (key === "main") return "main";
  const agent = /^agent:([^:]+):/.exec(key);
  return agent ? `person:${agent[1]}` : key;
}

/** Who wrote each character of a text and who deleted what between them. */
function writers(room: LiveRoom, text: Y.Text) {
  const written: Array<string | null> = [];
  const deletedAt: Array<{ at: number; key: string }> = [];
  let at = 0;
  for (let item = text._start; item; item = item.right) {
    if (!item.countable || itemText(item) === null) continue;
    const { client, clock } = item.id;
    if (!item.deleted) {
      const key = writerOf(room, client);
      for (let index = 0; index < item.length; index++) written.push(key);
      at += item.length;
      continue;
    }
    // A deleted run was deleted in one go, unless two runs were joined after; ask both ends.
    for (const offset of new Set([0, item.length - 1])) {
      const key = room.users.getUserByDeletedId(Y.createID(client, clock + offset));
      if (key) deletedAt.push({ at, key });
    }
  }
  return { written, deletedAt };
}

/** Builds a file's text with only the hunks of `included` groups applied to the base. */
function textWith(plan: FilePlan, included: ReadonlySet<Group>): string {
  const { base, final } = plan;
  let out = "";
  let at = 0;
  plan.chunks.forEach((chunk, index) => {
    const fromA = Math.min(chunk.fromA, base.length);
    const toA = Math.min(chunk.toA, base.length);
    out += base.slice(at, fromA);
    out += included.has(plan.groups[index]!)
      ? final.slice(Math.min(chunk.fromB, final.length), Math.min(chunk.toB, final.length))
      : base.slice(fromA, toA);
    at = toA;
  });
  return out + base.slice(at);
}

async function planFile(
  room: LiveRoom,
  join: LiveJoin,
  path: string,
  text: Y.Text,
  ender: string,
): Promise<FilePlan | null> {
  const final = text.toString();
  const found = await liveApi.baseFile(join.folder, join.baseCommit, path);
  const base = found ?? "";
  if (found !== null ? final === base : final === "") return null;
  const chunks = Chunk.build(Text.of(base.split("\n")), Text.of(final.split("\n")));
  const { written, deletedAt } = writers(room, text);
  const groups: Group[] = [];
  const touched: Array<Set<string>> = [];
  for (const chunk of chunks) {
    const keys = new Set<string>();
    for (const change of chunk.changes) {
      const from = chunk.fromB + change.fromB;
      const to = chunk.fromB + change.toB;
      for (let index = from; index < to; index++) {
        const key = written[index];
        if (key) keys.add(key);
      }
      for (const deletion of deletedAt)
        if (deletion.at >= from && deletion.at <= to) keys.add(deletion.key);
    }
    const people = new Set([...keys].map(ownerOf).filter((key) => key !== "main"));
    touched.push(people);
    groups.push(people.size > 1 ? shared : ([...people][0] ?? ender));
  }
  return { path, base, existed: found !== null, final, chunks, groups, touched };
}

function personOf(room: LiveRoom, key: string): LivePerson | undefined {
  return room.people.get(key);
}

/** "a.ts, b.ts and 2 more" */
function fileList(paths: string[]): string {
  if (paths.length <= 3) return paths.join(", ");
  return `${paths.slice(0, 3).join(", ")} and ${paths.length - 3} more`;
}

/** The commits that end a session, in order: each person's, then the shared one. */
export async function planCommits(room: LiveRoom, join: LiveJoin): Promise<CommitPlan> {
  const ender = `person:${room.me.id}`;
  const plans: FilePlan[] = [];
  for (const [path, text] of room.files.entries()) {
    const plan = await planFile(room, join, path, text, ender);
    if (plan) plans.push(plan);
  }
  // People in the order they first worked; the shared commit last.
  const firstAt = new Map<string, number>();
  for (const step of room.steps.toArray()) {
    const owner = ownerOf(`person:${step.author.ownerId}`);
    if (!firstAt.has(owner)) firstAt.set(owner, step.at);
  }
  const used = new Set(plans.flatMap((plan) => plan.groups));
  const order = [...used]
    .filter((group) => group !== shared)
    .sort((a, b) => (firstAt.get(a) ?? Infinity) - (firstAt.get(b) ?? Infinity));
  if (used.has(shared)) order.push(shared);

  const agentsOf = (key: string) =>
    [...room.people.values()]
      .filter((person) => person.kind === "agent" && `person:${person.ownerId}` === key)
      .map((person) => person.name);
  const nameOf = (key: string) => personOf(room, key)?.name ?? "Someone";
  const commits: PlannedCommit[] = [];
  const preview: CommitPreview[] = [];
  const included = new Set<Group>();
  for (const group of order) {
    included.add(group);
    const files: PlannedFile[] = [];
    const paths: string[] = [];
    let plus = 0;
    let minus = 0;
    const together = new Set<string>();
    for (const plan of plans) {
      const mine = plan.groups.map((owner, index) => (owner === group ? index : -1));
      const indexes = mine.filter((index) => index >= 0);
      if (!indexes.length) continue;
      files.push({ path: plan.path, text: textWith(plan, included) });
      paths.push(plan.path);
      for (const index of indexes) {
        const chunk = plan.chunks[index]!;
        plus += lineCount(plan.final.slice(chunk.fromB, Math.min(chunk.toB, plan.final.length)));
        minus += lineCount(plan.base.slice(chunk.fromA, Math.min(chunk.toA, plan.base.length)));
        for (const person of plan.touched[index]!) together.add(person);
      }
    }
    const people = group === shared ? [...together] : [group];
    const author = group === shared ? (people.includes(ender) ? ender : people[0]!) : group;
    const writer = personOf(room, author);
    const identity =
      writer?.gitName && writer.gitEmail ? { name: writer.gitName, email: writer.gitEmail } : null;
    const lines = [`Changes ${fileList(paths)}.`];
    const helpers = people.flatMap(agentsOf);
    if (helpers.length) lines.push(`With ${helpers.join(", ")}.`);
    if (!identity) lines.push(`Written by ${nameOf(author)}.`);
    const trailers: string[] = [];
    for (const other of people.filter((person) => person !== author)) {
      const them = personOf(room, other);
      if (them?.gitEmail)
        trailers.push(`Co-authored-by: ${them.gitName || them.name} <${them.gitEmail}>`);
      else lines.push(`Also written by ${nameOf(other)}.`);
    }
    const title = group === shared ? `${join.name}: written together` : join.name;
    const message = [title, "", ...lines, ...(trailers.length ? ["", ...trailers] : [])].join("\n");
    commits.push({ message, author: identity, files });
    preview.push({ group, names: people.map(nameOf), paths, plus, minus });
  }

  const mainPaths = new Set(
    room.steps
      .toArray()
      .filter((step) => step.author.id === mainAuthor.id)
      .map((step) => step.path),
  );
  const resolved = plans
    .filter((plan) => mainPaths.has(plan.path))
    .map((plan) => ({ path: plan.path, text: plan.final }));
  return { commits, preview, resolved };
}
