const linkPattern = /https?:\/\/[^\s<>"'`\]]+/gi;

function trimLink(link: string): string {
  let text = link;
  for (;;) {
    const last = text.slice(-1);
    const unbalanced =
      last === ")" && (text.match(/\)/g)?.length ?? 0) > (text.match(/\(/g)?.length ?? 0);
    if (!unbalanced && !/[.,;:!?*_~]/.test(last)) return text;
    text = text.slice(0, -1);
  }
}

function previewable(link: string): boolean {
  try {
    const { hostname } = new URL(link);
    return hostname.includes(".") && !/^[\d.]+$/.test(hostname) && !hostname.includes(":");
  } catch {
    return false;
  }
}

export function extractLinks(text: string, max = 3): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(linkPattern)) {
    const link = trimLink(match[0]);
    if (previewable(link) && !found.includes(link)) found.push(link);
    if (found.length >= max) break;
  }
  return found;
}
