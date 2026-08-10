import { Label } from "@/shared/ui";
import type { ReactNode } from "react";

export function AgentEditorField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Label className="grid gap-1.5">
      <span>{label}</span>
      {children}
    </Label>
  );
}
