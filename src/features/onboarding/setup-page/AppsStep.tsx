import { DirectApps } from "@/features/agents";

/**
 * The last setup step: apps that sign in directly on their makers' own pages, which need no key.
 * Apps that go through Composio need a developer key of the person's own, so they wait for the
 * integrations settings rather than first run.
 */
export function AppsStep() {
  return <DirectApps limit={8} />;
}
