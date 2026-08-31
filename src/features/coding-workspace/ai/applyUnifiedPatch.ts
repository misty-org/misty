export function applyUnifiedPatch(original: string, patch: string): string {
  if (!patch || patch.length > 256 << 10)
    throw new Error("The code patch is invalid or too large.");
  const source = original.replace(/\r\n/g, "\n").split("\n");
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  const output: string[] = [];
  let sourceIndex = 0;
  let patchIndex = 0;
  let hunks = 0;

  while (patchIndex < lines.length) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines[patchIndex]);
    if (!header) {
      patchIndex += 1;
      continue;
    }
    hunks += 1;
    const oldStart = Math.max(0, Number(header[1]) - 1);
    if (oldStart < sourceIndex || oldStart > source.length) {
      throw new Error("The code changed since this patch was generated.");
    }
    output.push(...source.slice(sourceIndex, oldStart));
    sourceIndex = oldStart;
    patchIndex += 1;
    let oldUsed = 0;
    let newUsed = 0;
    while (patchIndex < lines.length && !lines[patchIndex].startsWith("@@ ")) {
      const line = lines[patchIndex];
      if (line.startsWith("\\ No newline at end of file")) {
        patchIndex += 1;
        continue;
      }
      const marker = line[0];
      const value = line.slice(1);
      if (marker === " ") {
        if (source[sourceIndex] !== value)
          throw new Error("The code changed since this patch was generated.");
        output.push(value);
        sourceIndex += 1;
        oldUsed += 1;
        newUsed += 1;
      } else if (marker === "-") {
        if (source[sourceIndex] !== value)
          throw new Error("The code changed since this patch was generated.");
        sourceIndex += 1;
        oldUsed += 1;
      } else if (marker === "+") {
        output.push(value);
        newUsed += 1;
      } else if (line !== "" && !line.startsWith("--- ") && !line.startsWith("+++ ")) {
        throw new Error("The code patch contains an unsupported operation.");
      }
      patchIndex += 1;
    }
    const expectedRemoved = header[2] === undefined ? 1 : Number(header[2]);
    const expectedAdded = header[4] === undefined ? 1 : Number(header[4]);
    if (
      !Number.isFinite(expectedRemoved) ||
      !Number.isFinite(expectedAdded) ||
      oldUsed !== expectedRemoved ||
      newUsed !== expectedAdded
    ) {
      throw new Error("The code patch has inconsistent hunk counts.");
    }
  }
  if (hunks === 0) throw new Error("The code patch does not contain a unified diff hunk.");
  output.push(...source.slice(sourceIndex));
  return output.join("\n");
}
