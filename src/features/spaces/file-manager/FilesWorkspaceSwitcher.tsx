// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
import { Briefcase, Pencil, Plus, Settings, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  ConfirmDeleteDialog,
  DropdownMenu,
  DropdownMenuContent,
  IconButton,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
  RenameItemDialog,
} from "@misty/ui";
import { openSettings } from "@/features/settings";
import type { FilesWorkspace, FilesWorkspaceActions } from "./filesWorkspaces";
import type { FilesPlace } from "./model";

type Asking = { kind: "create" } | { kind: "rename"; space: FilesWorkspace } | { kind: "delete"; space: FilesWorkspace } | null;

/**
 * The top of Kura's sidebar: the open workspace as a menu that switches between them, each its own
 * set of tabs, with New workspace, Rename and Delete, and the settings gear beside it.
 */
export function FilesWorkspaceSwitcher({
  list,
  active,
  actions,
  home,
}: {
  list: FilesWorkspace[];
  active: FilesWorkspace;
  actions: FilesWorkspaceActions;
  /** Where a new workspace's first tab opens. */
  home: FilesPlace;
}) {
  const [asking, setAsking] = useState<Asking>(null);
  return (
    <div className="flex min-w-0 items-center gap-1">
      <DropdownMenu>
        <MenuTrigger label={active.title} icon={Briefcase} variant="secondary" className="flex-1" />
        <DropdownMenuContent align="start">
          <MenuRadioGroup value={active.id} onValueChange={actions.switchWorkspace}>
            {list.map((space) => (
              <MenuRadioItem key={space.id} value={space.id} label={space.title} />
            ))}
          </MenuRadioGroup>
          <MenuSeparator />
          <MenuItem icon={Plus} label="New workspace" onSelect={() => setAsking({ kind: "create" })} />
          <MenuItem icon={Pencil} label="Rename workspace" onSelect={() => setAsking({ kind: "rename", space: active })} />
          {list.length > 1 ? (
            <MenuItem icon={Trash2} label="Delete workspace" danger onSelect={() => setAsking({ kind: "delete", space: active })} />
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <IconButton label="Files settings" onClick={() => openSettings("drive")}>
        <Settings />
      </IconButton>
      {asking?.kind === "create" ? (
        <RenameItemDialog
          title="New workspace"
          initialName={`Workspace ${list.length + 1}`}
          confirmLabel="Create"
          onConfirm={async (name) => actions.createWorkspace(name, home)}
          onClose={() => setAsking(null)}
        />
      ) : asking?.kind === "rename" ? (
        <RenameItemDialog
          key={asking.space.id}
          title="Rename workspace"
          initialName={asking.space.title}
          onConfirm={async (name) => actions.renameWorkspace(asking.space.id, name)}
          onClose={() => setAsking(null)}
        />
      ) : null}
      <ConfirmDeleteDialog
        open={asking?.kind === "delete"}
        onOpenChange={(open) => !open && setAsking(null)}
        title="Delete workspace?"
        what={asking?.kind === "delete" ? `${asking.space.title} and its tabs` : ""}
        onConfirm={() => {
          if (asking?.kind === "delete") actions.deleteWorkspace(asking.space.id);
        }}
      />
    </div>
  );
}
