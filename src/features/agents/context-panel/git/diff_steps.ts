export interface DiffLine {
  kind: "added" | "removed" | "same" | "note";
  text: string;
}

export interface DiffStep {
  heading: string;
  lines: DiffLine[];
}

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
