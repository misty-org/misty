import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  MenuCheckItem,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSubmenu,
  MenuTrigger,
  OverflowFadeText,
  RowActions,
  Text,
} from "@/shared/ui";
import {
  AppWindow,
  Brain,
  Copy,
  Eye,
  FilePlus,
  Folder,
  FolderInput,
  FolderPlus,
  GitFork,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Rabbit,
  Trash2,
  Turtle,
} from "lucide-react";
import { useState } from "react";
import { GalleryRow, GallerySection } from "./GalleryLayout";

const sections = [
  { id: "today", name: "Today" },
  { id: "later", name: "Later" },
  { id: "archive", name: "Archive" },
];

// RowActions finds its row by the group/row class.
const tileClass = "group/row flex h-8 w-72 items-center gap-2 px-2 text-control";

/** One tree of rows, rendered in a dropdown, a right-click menu and a row's ⋯ alike. */
function ItemMenuRows() {
  const [pinned, setPinned] = useState(true);
  const [section, setSection] = useState("today");
  return (
    <>
      <MenuItem icon={Pencil} label="Rename" shortcut="R" onSelect={() => {}} />
      <MenuItem icon={Copy} label="Duplicate" shortcut="⌘D" onSelect={() => {}} />
      <MenuItem icon={GitFork} label="Fork" disabled reason="Wait for the run to finish" />
      <MenuCheckItem icon={Pin} label="Pinned" checked={pinned} onCheckedChange={setPinned} />
      <MenuSubmenu icon={FolderInput} label="Move to section">
        <MenuRadioGroup value={section} onValueChange={setSection}>
          {sections.map((item) => (
            <MenuRadioItem key={item.id} icon={Folder} value={item.id} label={item.name} />
          ))}
        </MenuRadioGroup>
      </MenuSubmenu>
      <MenuSeparator />
      <MenuItem icon={Trash2} label="Delete" danger onSelect={() => {}} />
    </>
  );
}

export function MenusSection() {
  const [mode, setMode] = useState("fast");
  const [showHidden, setShowHidden] = useState(false);
  return (
    <GallerySection title="Menus">
      <GalleryRow label="Dropdown">
        <DropdownMenu modal={false}>
          <MenuTrigger iconOnly label="More" icon={MoreHorizontal} />
          <DropdownMenuContent align="start" width="md">
            <ItemMenuRows />
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu modal={false}>
          <MenuTrigger label="New" icon={Plus} />
          <DropdownMenuContent width="md">
            <MenuGroup>
              <MenuLabel>Create in this folder</MenuLabel>
              <MenuItem icon={FolderPlus} label="Folder" shortcut="⇧⌘N" onSelect={() => {}} />
              <MenuItem icon={FilePlus} label="File" onSelect={() => {}} />
              <MenuItem icon={AppWindow} label="Page" onSelect={() => {}} />
            </MenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu modal={false}>
          <MenuTrigger
            label="Thinking mode"
            icon={Brain}
            value={mode === "fast" ? "Fast" : "Deep"}
            variant="secondary"
          />
          <DropdownMenuContent width="sm">
            <MenuRadioGroup value={mode} onValueChange={setMode}>
              <MenuRadioItem icon={Rabbit} value="fast" label="Fast" />
              <MenuRadioItem icon={Turtle} value="deep" label="Deep" />
            </MenuRadioGroup>
            <MenuSeparator />
            <MenuCheckItem
              icon={Eye}
              label="Show hidden files"
              checked={showHidden}
              onCheckedChange={setShowHidden}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </GalleryRow>
      <GalleryRow label="Right-click">
        <ContextMenu>
          <ContextMenuTrigger className="grid h-20 w-72 place-items-center">
            <Text size="meta" tone="muted">
              Right-click here
            </Text>
          </ContextMenuTrigger>
          <ContextMenuContent width="md">
            <ItemMenuRows />
          </ContextMenuContent>
        </ContextMenu>
      </GalleryRow>
      <GalleryRow label="RowActions">
        <div className={tileClass}>
          <OverflowFadeText className="flex-1" full>
            A tile with one ⋯ and the same menu on right-click
          </OverflowFadeText>
          <RowActions label="Tile actions">
            <ItemMenuRows />
          </RowActions>
        </div>
      </GalleryRow>
    </GallerySection>
  );
}
