import { DirectApps } from "@/features/agents";

/** The last setup step: apps that sign in directly on their makers' own pages, which need no key. */
export function AppsStep() {
  return <DirectApps limit={8} />;
}
