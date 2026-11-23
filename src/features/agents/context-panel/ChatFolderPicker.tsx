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
} from "@misty/ui";
import { folderName } from "../engines/engines_api";
import { useChatFolder, useChatFolders, useProjectFolders } from "../shared-folders/chat_folder";
import { errorText } from "./project_api";

const scratchValue = "scratch";

type PickerLook = "button" | "row" | "heading";

const pickerLook = (compact: boolean, heading: boolean): PickerLook =>
  heading ? "heading" : compact ? "row" : "button";

function FolderMenu(props: {
  label: string;
  current: string;
  scratch: boolean;
  look: PickerLook;
  onPick(path: string): Promise<unknown>;
  onChoose(): Promise<unknown>;
}) {
  const projects = useProjectFolders();
  const [error, setError] = useState("");
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });
  const report = (work: Promise<unknown>) =>
    void work.catch((reason) => setError(errorText(reason)));
  const paths = projects?.map((project) => project.path) ?? [];
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
      scratch={false}
      look={pickerLook(compact, heading)}
      onPick={(path) =>
        path ? store().use(conversationId, path) : store().scratch(conversationId)
      }
      onChoose={() => store().choose(conversationId)}
    />
  );
}

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
