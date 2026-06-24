export interface MistyActivityEntry {
  id: string;
  kind: "invocation" | "run";
  state: string;
  conversation_id: string;
  run_id: string;
  parent_run_id: string;
  delegation_depth: number;
  title: string;
  result?: string;
  updated_at: string;
  events: Array<{
    type?: string;
    text?: string;
    phase?: string;
    toolName?: string;
    tool_name?: string;
    error?: string;
  }>;
}
export function activityParent(entry: MistyActivityEntry, entries: MistyActivityEntry[]) {
  return entries.find(
    (parent) =>
      parent.id === entry.parent_run_id || (parent.run_id && parent.run_id === entry.parent_run_id),
  );
}
