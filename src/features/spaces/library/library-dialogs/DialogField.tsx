import { Label } from "@/shared/ui";
import type { ReactNode } from "react";

export function DialogField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Label className="grid gap-2">
      <span>{label}</span>
      {children}
    </Label>
  );
}
