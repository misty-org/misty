import { FolderOpen } from "lucide-react";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
  Skeleton,
  useNotice,
} from "@/shared/ui";
import { folderName } from "../engines/enginesApi";
import { useChatFolder, useChatFolders, useProjectFolders } from "../shared-folders/chatFolder";
import { errorText } from "./projectApi";

/** The Scratch row's value: folder paths are absolute, so none is this. */
const scratchValue = "scratch";

/**
 * The folder menu both pickers share: Scratch when it is offered, the person's projects by name,
 * most recently used first, with a checkmark on the one in use, then "Choose a folder…" for the
 * system's dialog. The projects are read again each time it opens.
 */
/** A button (the context panel), quiet text in a row (the session card), or a small button over
 * a file tree (the Code page's sidebar). */
type PickerLook = "button" | "row" | "heading";

const pickerLook = (compact: boolean, heading: boolean): PickerLook =>
  heading ? "heading" : compact ? "row" : "button";

function FolderMenu(props: {
  label: string;
  /** The project in use, or "" for scratch (or none). */
  current: string;
  /** Offers Scratch as a choice. */
  scratch: boolean;
  look: PickerLook;
  /** A project's path, or "" for Scratch. */
  onPick(path: string): Promise<unknown>;
  onChoose(): Promise<unknown>;
}) {
  const projects = useProjectFolders();
  const [error, setError] = useState("");
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });
  const report = (work: Promise<unknown>) =>
    void work.catch((reason) => setError(errorText(reason)));
  const paths = projects?.map((project) => project.path) ?? [];
  // The one in use is listed even before the list has been read, or when it has dropped off it.
  if (props.current && !paths.includes(props.current)) paths.unshift(props.current);
  const value = props.current
    ? folderName(props.current)
    : props.scratch
      ? "Scratch"
      : "No project";
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open)
          void useChatFolders
            .getState()
            .loadProjects()
            .catch(() => undefined);
      }}
    >
      <MenuTrigger
        label={props.label}
        value={value}
        plain={props.look === "row"}
        size={props.look === "heading" ? "sm" : undefined}
      />
      <DropdownMenuContent align="start" width="xl">
        {props.scratch || paths.length ? (
          <>
            <MenuRadioGroup
              value={props.current || scratchValue}
              onValueChange={(next) => {
                const path = next === scratchValue ? "" : next;
                if (path !== props.current) report(props.onPick(path));
              }}
            >
              {props.scratch ? <MenuRadioItem value={scratchValue} label="Scratch" /> : null}
              {paths.map((path) => (
                <MenuRadioItem key={path} value={path} label={folderName(path)} />
              ))}
            </MenuRadioGroup>
            <MenuSeparator />
          </>
        ) : null}
        <MenuItem
          icon={FolderOpen}
          label="Choose a folder…"
          onSelect={() => report(props.onChoose())}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Which project a Code chat works in, as a menu: one of the person's projects, or another folder
 * picked in the system's dialog. A new chat with no id yet keeps the choice until it starts.
 * `compact` draws it as quiet text, for the session card's Folder row; `heading` as a small
 * button over a file tree.
 */
export function ChatFolderPicker({
  conversationId,
  compact = false,
  heading = false,
}: {
  conversationId: string | undefined;
  compact?: boolean;
  heading?: boolean;
}) {
  const { folder, kind, loaded, failed } = useChatFolder(conversationId);
  if (!loaded && !failed)
    return (
      <Skeleton
        className={compact ? "h-3 w-20" : heading ? "h-6 w-28 rounded-md" : "h-8 w-36 rounded-md"}
      />
    );
  const store = useChatFolders.getState;
  return (
    <FolderMenu
      label="Chat folder"
      current={kind === "project" ? folder : ""}
      // Only Code's chats pick a folder, and they stay in a project: going back to scratch would
      // move the chat out of Code.
      scratch={false}
      look={pickerLook(compact, heading)}
      onPick={(path) =>
        path ? store().use(conversationId, path) : store().scratch(conversationId)
      }
      onChoose={() => store().choose(conversationId)}
    />
  );
}

/**
 * A project folder as a menu, for a page with no chat (the Code page): the person's projects, or
 * another folder picked in the system's dialog, which becomes one of them. `onPick` gets the path.
 */
export function ProjectPicker({
  value,
  onPick,
  compact = false,
  heading = false,
}: {
  value: string;
  onPick(path: string): void;
  compact?: boolean;
  heading?: boolean;
}) {
  return (
    <FolderMenu
      label="Project folder"
      current={value}
      scratch={false}
      look={pickerLook(compact, heading)}
      onPick={async (path) => {
        if (path) onPick(path);
      }}
      onChoose={async () => {
        const path = await useChatFolders.getState().addProject();
        if (path) onPick(path);
      }}
    />
  );
}
