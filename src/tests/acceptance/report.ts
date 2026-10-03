import { mkdirSync, writeFileSync } from "node:fs";

/** Local, git-ignored evidence for each live acceptance case. */
const root = new URL("../../../.misty/acceptance/", import.meta.url);

export function writeAcceptanceReport(name: string, report: Record<string, unknown>) {
  mkdirSync(root, { recursive: true });
  const { image, ...rest } = report as { image?: { dataUrl?: string } };
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  writeFileSync(new URL(`${slug}.json`, root), `${JSON.stringify(rest, null, 2)}\n`);
  const data = image?.dataUrl?.split(",")[1];
  if (data) writeFileSync(new URL(`${slug}.jpg`, root), Buffer.from(data, "base64"));
}
