import { CheckCircle2, CircleAlert, CircleDot } from "lucide-react";
import type { InstallEvent } from "../types/setup";

export function eventIcon(level?: InstallEvent["level"]) {
  if (level === "error") {
    return <CircleAlert aria-hidden="true" className="h-4 w-4 shrink-0 text-red-300" />;
  }

  if (level === "warn") {
    return <CircleAlert aria-hidden="true" className="h-4 w-4 shrink-0 text-amber-300" />;
  }

  if (level === "info") {
    return <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0 text-[#dbdee1]" />;
  }

  return <CircleDot aria-hidden="true" className="h-4 w-4 shrink-0 text-[#949ba4]" />;
}
