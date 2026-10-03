import { cn } from "../utils";

/**
 * Three dots that fill in turn after working text ("Reading your notes..."), in
 * place of a spinner. Decorative: the text beside it carries the status.
 */
export function AnimatedEllipsis({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("misty-ellipsis", className)}>
      <span>.</span>
      <span>.</span>
      <span>.</span>
    </span>
  );
}

/** Working text without its own trailing ellipsis, so the animated one can follow. */
export function withoutEllipsis(text: string): string {
  return text.replace(/\s*(?:…|\.{3})\s*$/, "");
}
