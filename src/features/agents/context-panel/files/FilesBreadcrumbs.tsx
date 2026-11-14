import { ChevronRight, Folder, MoreHorizontal } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  MenuItem,
  MenuTrigger,
  OverflowFadeText,
  Text,
  SidePanelLead,
} from "@/shared/ui";
import { fileName, useFilesStore } from "./filesStore";
import { treeLineage } from "./paths";

/** Folders shown by name after the root; the ones above them fold into a menu. */
const MOST_SHOWN = 2;

/** Shows a folder in the tree: back to the tree, opened down to it, selected and scrolled to. */
function goTo(dir: string) {
  const files = useFilesStore.getState();
  files.activateFile(null);
  files.selectPath(dir, true);
  void files.revealDir(dir);
}

/** The arrow between two crumbs. */
function Between() {
  return (
    <Text bare tone="muted" className="inline-flex flex-none" aria-hidden>
      <ChevronRight />
    </Text>
  );
}

/**
 * Where the Files panel is, in its header row: the folder it shows as a menu that switches to
 * another (`picker`), then each folder down to the open file, or to what's selected in the tree.
 * A folder's crumb shows it in the tree; folders past the last two fold into a menu.
 */
export function FilesBreadcrumbs(props: { folder: string; picker: ReactNode }) {
  const root = useFilesStore((state) => state.root);
  const active = useFilesStore((state) => state.activeFilePath);
  const selected = useFilesStore((state) => state.selectedPath);
  const selectedIsDir = useFilesStore((state) => state.selectedIsDir);
  // The open file, else what's selected in the tree; nothing while the store still names the
  // folder shown before.
  const here = root === props.folder ? (active ?? selected) : null;
  const isFile = active !== null || (selected !== null && !selectedIsDir);
  const lineage = (here && treeLineage(root, here)) || [root];
  const below = lineage.slice(1);
  const dirs = isFile ? below.slice(0, -1) : below;
  const file = isFile ? below[below.length - 1] : undefined;
  const folded = dirs.slice(0, Math.max(0, dirs.length - MOST_SHOWN));
  const shown = dirs.slice(folded.length);

  return (
    <nav aria-label="Folder path" className="flex min-w-0 flex-1 items-center gap-0.5">
      <SidePanelLead>{props.picker}</SidePanelLead>
      {folded.length > 0 ? (
        <>
          <Between />
          <DropdownMenu>
            <MenuTrigger iconOnly size="sm" label="Folders above" icon={MoreHorizontal} />
            <DropdownMenuContent align="start" className="w-60 max-w-[calc(100vw-16px)]">
              {folded.map((dir) => (
                <MenuItem
                  key={dir}
                  icon={<Folder />}
                  label={fileName(dir)}
                  onSelect={() => goTo(dir)}
                />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ) : null}
      {shown.map((dir) => (
        <Fragment key={dir}>
          <Between />
          <Button
            variant="quiet"
            size="sm"
            shrink
            aria-current={!file && dir === shown[shown.length - 1] ? "location" : undefined}
            onClick={() => goTo(dir)}
          >
            <OverflowFadeText full>{fileName(dir)}</OverflowFadeText>
          </Button>
        </Fragment>
      ))}
      {file ? (
        <>
          <Between />
          <Text size="control" tone="bright" className="min-w-0 px-1" aria-current="location">
            <OverflowFadeText full>{fileName(file)}</OverflowFadeText>
          </Text>
        </>
      ) : null}
    </nav>
  );
}
