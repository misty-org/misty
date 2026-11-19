import {
  Avatar,
  AvatarFallback,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  IconButton,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  SplitButton,
  Text,
  Tooltip,
  WorkspaceOverlay,
  ZoomControl,
} from "@/shared/ui";
import {
  ClipboardCopy,
  Copy,
  Download,
  Eye,
  FilePlus2,
  History,
  RotateCcw,
  RotateCw,
  Share,
} from "lucide-react";
import type { ReactNode } from "react";
import type { ImagePerson } from "./imagePresence";
import type { Viewport } from "./useViewport";

/** The editor over the window, as the video editor sits: its bar, then the editor's panes. */
export function EditorFrame(props: { name: string; onClose: () => void; children: ReactNode }) {
  return (
    <WorkspaceOverlay open ariaLabel={`Edit ${props.name}`} onClose={props.onClose}>
      <div className="flex size-full min-h-0 flex-col">{props.children}</div>
    </WorkspaceOverlay>
  );
}

/** The bar's title: the image's name, and where it sits among its neighbors. */
export function EditorTitle(props: { name: string; indexLabel?: string }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <Text size="control" tone="bright" weight="medium" full className="min-w-0">
        {props.name}
      </Text>
      {props.indexLabel ? (
        <Text size="meta" tone="muted" className="shrink-0">
          {props.indexLabel}
        </Text>
      ) : null}
    </div>
  );
}

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return (
    words.length === 1 ? words[0].slice(0, 2) : `${words[0][0]}${words[words.length - 1][0]}`
  ).toUpperCase();
}

/** Who else is in the image, by face: people in their tone, agents named as agents. */
export function PeopleHere({ people }: { people: ImagePerson[] }) {
  const shown = people.slice(0, 4);
  const more = people.length - shown.length;
  return (
    <div role="group" aria-label="In this image now" className="flex items-center gap-1">
      {shown.map((person) => (
        <Tooltip key={person.id} content={person.agent ? `${person.name} (agent)` : person.name}>
          <Avatar size="sm" tone={person.tone} aria-label={person.name}>
            <AvatarFallback>{initials(person.name)}</AvatarFallback>
          </Avatar>
        </Tooltip>
      ))}
      {more > 0 ? (
        <Tooltip
          content={people
            .slice(4)
            .map((person) => person.name)
            .join(", ")}
        >
          <Text size="meta" tone="muted" className="px-1 tabular-nums">
            {`+${more}`}
          </Text>
        </Tooltip>
      ) : null}
    </div>
  );
}

/**
 * Save, and the other ways out of the editor: a copy, another name or format, a download, the
 * clipboard, or back to the original. With nothing changed it is one menu button.
 */
export function SaveControls(props: {
  dirty: boolean;
  readonly: boolean;
  busy: boolean;
  /** Whether "Save" saves over the original; otherwise it saves a copy. */
  savesOver: boolean;
  onSave: () => void;
  onSaveCopy: () => void;
  onSaveAs: () => void;
  onDownload: () => void;
  onCopyImage: () => void;
  onRevert: () => void;
}) {
  const { dirty, readonly, busy } = props;
  const menu = (
    <DropdownMenuContent align="end" width="md">
      {readonly ? null : (
        <>
          {props.savesOver && dirty ? (
            <MenuItem icon={Copy} label="Save as copy" shortcut="⇧⌘S" onSelect={props.onSaveCopy} />
          ) : null}
          <MenuItem icon={FilePlus2} label="Save as…" onSelect={props.onSaveAs} />
        </>
      )}
      <MenuItem icon={Download} label="Download" onSelect={props.onDownload} />
      <MenuItem icon={ClipboardCopy} label="Copy image" onSelect={props.onCopyImage} />
      {readonly || !dirty ? null : (
        <>
          <MenuSeparator />
          <MenuItem icon={History} label="Revert to original" onSelect={props.onRevert} />
        </>
      )}
    </DropdownMenuContent>
  );
  if (dirty && !readonly)
    return (
      <SplitButton label="Save">
        <Button variant="primary" disabled={busy} onClick={props.onSave}>
          {props.savesOver ? "Save" : "Save as copy"}
        </Button>
        <DropdownMenu>
          <MenuTrigger
            iconOnly
            chevron
            label="More ways to save"
            variant="primary"
            disabled={busy}
          />
          {menu}
        </DropdownMenu>
      </SplitButton>
    );
  return (
    <DropdownMenu>
      <MenuTrigger
        iconOnly
        icon={Share}
        label={readonly ? "Download or copy" : "Save a copy, download or copy"}
        disabled={busy}
      />
      {menu}
    </DropdownMenu>
  );
}

/** The controls under the image: turning it, the original beside the edit, and the zoom. */
export function ViewControls(props: {
  readonly: boolean;
  dirty: boolean;
  compare: boolean;
  onCompare: () => void;
  onTurn: (clockwise: boolean) => void;
  viewport: Viewport;
}) {
  const { viewport } = props;
  return (
    <>
      <div className="flex items-center gap-1">
        {props.readonly ? null : (
          <>
            <IconButton label="Rotate left" shortcut="⇧⌘R" onClick={() => props.onTurn(false)}>
              <RotateCcw />
            </IconButton>
            <IconButton label="Rotate right" shortcut="⌘R" onClick={() => props.onTurn(true)}>
              <RotateCw />
            </IconButton>
          </>
        )}
        {props.dirty ? (
          <IconButton
            label={props.compare ? "Show the edit" : "Show the original"}
            aria-pressed={props.compare}
            onClick={props.onCompare}
          >
            <Eye />
          </IconButton>
        ) : null}
      </div>
      <ZoomControl
        value={viewport.fitted ? "Fit" : `${Math.round(viewport.scale * 100)}%`}
        canZoomIn={viewport.canZoomIn}
        canZoomOut={viewport.canZoomOut}
        onZoomIn={viewport.zoomIn}
        onZoomOut={viewport.zoomOut}
        shortcuts={{ zoomIn: "⌘+", zoomOut: "⌘−" }}
      >
        <MenuItem label="Zoom to fit" shortcut="⌘0" onSelect={viewport.fit} />
        <MenuSeparator />
        <MenuItem label="50%" onSelect={() => viewport.zoomTo(0.5)} />
        <MenuItem label="100%" shortcut="⌘1" onSelect={() => viewport.zoomTo(1)} />
        <MenuItem label="200%" onSelect={() => viewport.zoomTo(2)} />
        <MenuItem label="400%" onSelect={() => viewport.zoomTo(4)} />
      </ZoomControl>
    </>
  );
}
