import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AppLogoImage,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ListRow,
} from "@misty/ui";
import { createDeviceSetting } from "@/shared/lib/deviceSetting";
import type { SpaceLibraryItem } from "../../api/dto/entities";
import { appRoute } from "../../apps/appRoutes";
import { acceptsFile, fileRef } from "../../apps/spaceAppFiles";
import { appEntry, catalogLogoUrl, runsHere, type CatalogApp } from "../../apps/thirdPartyApps";
import { useSpaceApps } from "../../apps/useSpaceApps";

/**
 * The app each kind of file last opened in on this device, by its kind (`.png`, or its type when it has no
 * extension). Settings belong to the device and never sync.
 */
const useOpenWithChoices = createDeviceSetting<Record<string, string>>({
  scope: "files.open-with",
  defaults: {},
  normalize: (stored) =>
    stored && typeof stored === "object"
      ? Object.fromEntries(
          Object.entries(stored as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : {},
});

/** A file's kind for Open with: its extension, or its type when its name has none. */
export function fileKind(name: string, mime: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot).toLowerCase() : mime || "file";
}

/** An added app that can open a file, as Open with lists it. */
export interface OpenWithApp {
  id: string;
  name: string;
  logo: string;
}

const opensFile = (entry: CatalogApp, mime: string, name: string) => {
  const opens = entry.manifest.opens;
  const kinds = Array.isArray(opens) ? opens.filter((kind): kind is string => typeof kind === "string") : [];
  // An app that names no kinds opens none from Files: it hasn't said what it reads.
  return kinds.length > 0 && acceptsFile(kinds, mime, name) && runsHere(entry);
};

/**
 * Open with for a Space's Files: the added apps that open a file, the one it last opened in on this device, and
 * opening a file. A file opens in that app at once; with apps that open it but none chosen yet, Misty asks which
 * (`OpenWithDialog`), and the answer is remembered; with none, it opens in Files' own preview.
 */
export function useOpenWith(spaceId: string, preview: (item: SpaceLibraryItem) => void) {
  const navigate = useNavigate();
  const { apps } = useSpaceApps(spaceId);
  const choices = useOpenWithChoices((state) => state.value);
  const setChoices = useOpenWithChoices((state) => state.set);
  const [asking, setAsking] = useState<SpaceLibraryItem | null>(null);
  useEffect(() => void useOpenWithChoices.getState().load(), []);

  const appsFor = (item: SpaceLibraryItem): OpenWithApp[] => {
    const { mime, name } = fileRef(item);
    return (apps ?? []).flatMap((app) => {
      const entry = appEntry(app);
      return entry && opensFile(entry, mime, name)
        ? [{ id: app.app_id, name: entry.name, logo: catalogLogoUrl(entry) }]
        : [];
    });
  };
  const openIn = (item: SpaceLibraryItem, appId: string) => {
    const { mime, name } = fileRef(item);
    setChoices((current) => ({ ...current, [fileKind(name, mime)]: appId }));
    navigate(`${appRoute(spaceId, appId)}?file=${encodeURIComponent(item.id)}`);
  };
  const open = (item: SpaceLibraryItem) => {
    const candidates = appsFor(item);
    if (!candidates.length) return preview(item);
    const { mime, name } = fileRef(item);
    const last = choices[fileKind(name, mime)];
    if (last && candidates.some((app) => app.id === last)) return openIn(item, last);
    setAsking(item);
  };
  const dialog = asking ? (
    <OpenWithDialog
      fileName={fileRef(asking).name}
      apps={appsFor(asking)}
      onPick={(appId) => {
        const item = asking;
        setAsking(null);
        openIn(item, appId);
      }}
      onPreview={() => {
        const item = asking;
        setAsking(null);
        preview(item);
      }}
      onClose={() => setAsking(null)}
    />
  ) : null;
  return { appsFor, open, openIn, dialog };
}

/** Which app a file opens in, asked the first time a kind of file has more than Files' preview to open in. */
function OpenWithDialog(props: {
  fileName: string;
  apps: OpenWithApp[];
  onPick(appId: string): void;
  onPreview(): void;
  onClose(): void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent size="sm" aria-describedby={undefined}>
        <div className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{`Open ${props.fileName} with`}</DialogTitle>
          </DialogHeader>
          <ul className="m-0 grid list-none gap-0.5 p-0" aria-label="Apps">
            {props.apps.map((app) => (
              <li key={app.id}>
                <ListRow
                  label={app.name}
                  leading={<AppLogoImage src={app.logo || undefined} name={app.name} size="row" />}
                  onOpen={() => props.onPick(app.id)}
                />
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="quiet" size="lg" onClick={props.onClose}>
              Cancel
            </Button>
            <Button variant="secondary" size="lg" onClick={props.onPreview}>
              Preview
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
