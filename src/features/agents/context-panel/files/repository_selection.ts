// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).

function normalize(path: string): string {
  const unified = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-zA-Z]:\//.test(unified) ? unified.toLowerCase() : unified;
}

export function isWithinDirectory(dir: string, pathOrDir: string): boolean {
  const d = normalize(dir);
  const p = normalize(pathOrDir);
  return p === d || p.startsWith(d + "/");
}

function parentDirectory(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx > 0 ? trimmed.slice(0, idx) : trimmed;
}

interface RepositorySelectionInput {
  selectedPath: string | null;
  repositoryRoots: readonly string[];
  workspacePath: string;
}

export function resolveSelectedRepository(input: RepositorySelectionInput): string | null {
  const { selectedPath, repositoryRoots, workspacePath } = input;
  if (!selectedPath) return null;
  if (!isWithinDirectory(workspacePath, selectedPath)) return null;
  const roots: Record<string, string> = {};
  for (const p of repositoryRoots) roots[normalize(p)] = p;
  let candidate = selectedPath;
  let previous = "";
  while (isWithinDirectory(workspacePath, candidate)) {
    if (candidate !== previous) {
      const hit = roots[normalize(candidate)];
      if (hit && !isWithinDirectory(hit, workspacePath)) return hit;
      previous = candidate;
    }
    const next = parentDirectory(candidate);
    if (next === candidate) break;
    candidate = next;
  }
  return null;
}

export function resolveWorkspaceRepository(input: RepositorySelectionInput): string {
  return resolveSelectedRepository(input) ?? input.workspacePath;
}
