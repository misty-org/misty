export const ROOT_ID = "space";

export type MemoryBranch = "moments" | "summaries" | "facts" | "workflows";
export type MemoryNodeType = "branch" | "group" | "moment" | "summary" | "fact" | "workflow";
export type MemoryRange = "today" | "week" | "all";

/** One node of a Space's memory tree, as the server describes it. */
export interface MemoryNode {
  id: string;
  parent: string;
  type: MemoryNodeType;
  branch: MemoryBranch;
  source?: string;
  label: string;
  detail?: string;
  count: number;
  preview?: string;
  text?: string;
  app?: string;
  url?: string;
  first_at?: string;
  last_at?: string;
  searchable: boolean;
  expandable: boolean;
}

export interface ForgetCounts {
  moments: number;
  summaries: number;
  facts: number;
  workflows: number;
}

/** What a memory written by hand needs; which fields apply depends on the branch. */
export interface NewMemory {
  branch: MemoryBranch;
  title?: string;
  description?: string;
  text: string;
  /** Facts only: fact, preference or instruction. */
  kind?: string;
}

export const branchLabels: Record<MemoryBranch, string> = {
  moments: "Moments",
  summaries: "Summaries",
  facts: "Facts",
  workflows: "Workflows",
};

export const sourceLabels: Record<string, string> = {
  page: "Web pages",
  screen: "Screen",
  voice: "Dictation",
  recording: "Recordings",
  note: "Notes",
};

/** The time window the page lists moments in; summaries, facts and workflows ignore it. */
export function rangeBounds(range: MemoryRange, now = new Date()): { from?: string; to?: string } {
  if (range === "all") return {};
  const from = new Date(now);
  if (range === "today") from.setHours(0, 0, 0, 0);
  else from.setDate(from.getDate() - 7);
  return { from: from.toISOString(), to: new Date(now.getTime() + 60_000).toISOString() };
}

export function isLeaf(node: Pick<MemoryNode, "type">): boolean {
  return node.type !== "branch" && node.type !== "group";
}

/** The group a moment belongs to, so a search hit can be shown in the tree. */
export function momentGroupId(event: { kind: string; site?: string; session_id?: string }): string {
  if (event.session_id) return `moments:session:${event.session_id}`;
  if (event.kind === "page") return `moments:site:${event.site ?? ""}`;
  return `moments:kind:${event.kind}`;
}
