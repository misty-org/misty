/** One line of a unified diff, as the panel draws it. */
export interface DiffLine {
  kind: "added" | "removed" | "same" | "note";
  text: string;
}

/** One hunk: a stretch of a file that changed, with the lines around it. */
export interface DiffStep {
  /** Where in the file it is, as Git writes it (`@@ -12,6 +12,9 @@ fn name`). */
  heading: string;
  lines: DiffLine[];
}

/**
 * Splits a unified diff into its hunks, in order. The file headers before the first hunk are
 * dropped: the panel already names the file. A diff with no hunks (a binary file, a mode change)
 * comes back as one step holding what Git said.
 */
export function diffSteps(patch: string): DiffStep[] {
  const steps: DiffStep[] = [];
  const preamble: string[] = [];
  for (const line of patch.split("\n")) {
    if (line.startsWith("@@")) {
      steps.push({ heading: line, lines: [] });
      continue;
    }
    const step = steps[steps.length - 1];
    if (!step) {
      preamble.push(line);
      continue;
    }
    if (line.startsWith("+")) step.lines.push({ kind: "added", text: line.slice(1) });
    else if (line.startsWith("-")) step.lines.push({ kind: "removed", text: line.slice(1) });
    else if (line.startsWith("\\")) step.lines.push({ kind: "note", text: line.slice(2) });
    else step.lines.push({ kind: "same", text: line.slice(1) });
  }
  for (const step of steps) {
    // The split leaves one empty line after the last hunk's final newline.
    const last = step.lines[step.lines.length - 1];
    if (last && last.kind === "same" && last.text === "") step.lines.pop();
  }
  if (!steps.length) {
    const said = preamble.filter((line) => line.trim());
    if (said.length)
      steps.push({ heading: "", lines: said.map((text) => ({ kind: "note", text })) });
  }
  return steps;
}
