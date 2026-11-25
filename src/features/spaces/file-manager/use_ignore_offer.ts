import { notify } from "@misty/ui";
import { useEffect } from "react";
import { useRegistry, type IgnoreTemplate } from "@/native/registry";
import { driveChild, driveNative, drivePath } from "../drive";
import { useSpacesStore } from "../list/use_spaces_store";
import type { FileItem, FilesPlace } from "./model";

const IGNORE_FILE = ".mistyignore";
const IGNORE_READ_LIMIT = 256 * 1024;
const offered = new Set<string>();

function markedBy(marker: string, item: FileItem): boolean {
  const folder = marker.endsWith("/");
  const name = folder ? marker.slice(0, -1) : marker;
  if (folder !== item.folder) return false;
  if (name.startsWith("*."))
    return item.name.toLowerCase().endsWith(name.slice(1).toLowerCase()) && item.name.length > name.length - 1;
  return item.name === name;
}

export function missingRules(text: string, rules: readonly string[]): string[] {
  const have = new Set(text.split(/\r?\n/).map((line) => line.trim()));
  return rules.filter((rule) => !have.has(rule));
}

export function ignoreTextWith(text: string, name: string, missing: readonly string[]): string {
  const lead = text === "" || text.endsWith("\n") ? text : `${text}\n`;
  const gap = lead === "" ? "" : "\n";
  return `${lead}${gap}# ${name}\n${missing.join("\n")}\n`;
}

async function readIgnore(spaceId: string, folder: string) {
  const path = driveChild(folder, IGNORE_FILE);
  const entry = await driveNative.entry(spaceId, path);
  if (!entry) return { entry: null, text: "" };
  if (entry.kind !== "file") return null;
  const bytes = await driveNative.read(spaceId, path, IGNORE_READ_LIMIT);
  return { entry, text: new TextDecoder().decode(bytes) };
}

async function addRules(spaceId: string, folder: string, template: IgnoreTemplate) {
  const now = await readIgnore(spaceId, folder);
  if (!now) throw new Error(`${IGNORE_FILE} isn't a file here.`);
  const missing = missingRules(now.text, template.rules);
  if (!missing.length) return;
  const text = ignoreTextWith(now.text, template.name, missing);
  await driveNative.write(
    spaceId,
    folder,
    IGNORE_FILE,
    new TextEncoder().encode(text),
    now.entry ? { item_id: now.entry.id, version: now.entry.version ?? 0 } : undefined,
  );
}

async function offer(spaceId: string, folder: string, templates: readonly IgnoreTemplate[]) {
  const now = await readIgnore(spaceId, folder);
  if (!now) return;
  const template = templates.find((each) => missingRules(now.text, each.rules).length > 0);
  if (!template) return;
  notify({
    id: `ignore-offer:${spaceId}:${folder}`,
    message: `This folder looks like a ${template.name} project`,
    action: {
      label: "Add ignore rules",
      onSelect: () =>
        void addRules(spaceId, folder, template).catch(() =>
          notify({
            message: `The ${template.name} rules couldn't be added to ${IGNORE_FILE}. Try again.`,
            tone: "error",
          }),
        ),
    },
  });
}

export function useIgnoreOffer(
  place: FilesPlace,
  items: readonly FileItem[] | null | undefined,
  on: boolean,
) {
  const templates = useRegistry((state) => state.ignore);
  const spaceId = place.kind === "space-drive" ? place.spaceId : undefined;
  const folder = place.kind === "space-drive" ? drivePath(place.path) : undefined;
  const mayEditRoot = useSpacesStore((store) => {
    const space = store.spaces.find((each) => each.id === spaceId);
    const held: readonly string[] = space?.permissions ?? [];
    return space?.role === "owner" || held.includes("drive.purge") || held.includes("administrator");
  });
  useEffect(() => {
    if (!on || !spaceId || !folder || !items?.length || !templates?.length) return;
    if (folder === "/" && !mayEditRoot) return;
    const marked = templates.filter((template) =>
      template.markers.some((marker) => items.some((item) => markedBy(marker, item))),
    );
    const fresh = marked.filter((template) => !offered.has(`${spaceId}:${folder}:${template.id}`));
    if (!fresh.length) return;
    for (const template of fresh) offered.add(`${spaceId}:${folder}:${template.id}`);
    void offer(spaceId, folder, fresh).catch(() => undefined);
  }, [on, spaceId, folder, items, templates, mayEditRoot]);
}
