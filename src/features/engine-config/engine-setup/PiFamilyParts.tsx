// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong): PiFamilyAuthSection.tsx,
// PiFamilyOauthSection.tsx, PiFamilyApiKeySection.tsx and PiFamilyCustomSection.tsx.
// See NOTICE.
import type { ReactNode } from "react";
import { RowGroup, StateMark } from "@misty/ui";

export type PiEngine = "pi" | "omp";

export const ROW = "flex min-h-10 w-full min-w-0 items-center gap-3 rounded-lg px-3 py-1.5";

export function RowsCard({ children }: { children: ReactNode }) {
  return <RowGroup>{children}</RowGroup>;
}

export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function State({ on, label }: { on: boolean; label: string }) {
  return on ? <StateMark kind="online" label={label} className="shrink-0" /> : null;
}
