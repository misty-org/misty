import { Copy } from "lucide-react";

/** Restore uses the same glyph size and stroke as the other caption controls. */
export function RestoreGlyph() {
  return <Copy size={16} strokeWidth={1.5} aria-hidden="true" />;
}
