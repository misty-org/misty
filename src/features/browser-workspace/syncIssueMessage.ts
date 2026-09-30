import { syncIssueStatus } from "./syncStatus";
/** Compatibility for native diagnostics; status copy belongs to the shared selector. */
export function syncIssueMessage(issue: string | null | undefined): string | null {
  return issue ? syncIssueStatus(issue).detail : null;
}
