import { Terminal } from "lucide-react";
import { BrandIcon } from "@/shared/ui";
import { codingTools } from "./codingTools";

/** A coding tool's official logo, or a plain terminal mark for tools without artwork. */
export function CodingToolIcon({ tool, size = 16 }: { tool: string; size?: number }) {
  const brand = codingTools.find((candidate) => candidate.id === tool)?.brand;
  return brand ? (
    <BrandIcon brand={brand} size={size} />
  ) : (
    <Terminal aria-hidden className="shrink-0" style={{ width: size, height: size }} />
  );
}
