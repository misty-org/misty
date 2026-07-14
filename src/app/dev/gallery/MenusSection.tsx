import {
  ContextMenu,
  ContextMenuAction,
  ContextMenuContent,
  ContextMenuSeparator,
  ContextMenuSubmenu,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  MenuItem,
  MenuSubmenu,
  MenuTrigger,
  toolbarIconProps,
} from "@/shared/ui";
import {
  AppWindow,
  Brain,
  Copy,
  FilePlus,
  FolderPlus,
  History,
  MoreVertical,
  Pencil,
  Plus,
  QrCode,
  Share2,
  Trash2,
  VenetianMask,
} from "lucide-react";
import { useState } from "react";
import { GalleryRow, GallerySection } from "./GalleryLayout";

export function MenusSection() {
  const [model, setModel] = useState("fast");
  const [showHidden, setShowHidden] = useState(false);
  return (
    <GallerySection
      title="Menus"
      note="Rows are MenuItem (icon · label · shortcut). Labeled triggers get a chevron that flips open; icon-only triggers never do."
    >
      <GalleryRow label="Icon-only trigger">
        <DropdownMenu modal={false}>
          <MenuTrigger iconOnly label="More" icon={<MoreVertical {...toolbarIconProps} />} />
          <DropdownMenuContent align="end" width="lg">
            <MenuItem icon={<Plus />} label="New tab" shortcut="⌘T" onSelect={() => {}} />
            <MenuItem icon={<AppWindow />} label="New window" shortcut="⌘N" onSelect={() => {}} />
            <MenuItem icon={<VenetianMask />} label="New private tab" shortcut="⇧⌘N" />
            <DropdownMenuSeparator />
            <MenuSubmenu icon={<History />} label="History">
              <MenuItem label="Show full history" shortcut="⌘Y" onSelect={() => {}} />
              <MenuItem label="Clear browsing data…" onSelect={() => {}} />
            </MenuSubmenu>
            <MenuSubmenu icon={<Share2 />} label="Share">
              <MenuItem icon={<Copy />} label="Copy link" onSelect={() => {}} />
              <MenuItem icon={<QrCode />} label="QR code…" onSelect={() => {}} />
            </MenuSubmenu>
            <DropdownMenuSeparator />
            <MenuItem icon={<Trash2 />} label="Delete" destructive onSelect={() => {}} />
            <MenuItem icon={<Pencil />} label="Disabled row" disabled />
          </DropdownMenuContent>
        </DropdownMenu>
      </GalleryRow>
      <GalleryRow label="Labeled trigger">
        <DropdownMenu modal={false}>
          <MenuTrigger label="New" icon={<Plus />} />
          <DropdownMenuContent width="md">
            <DropdownMenuLabel>Create in this folder</DropdownMenuLabel>
            <MenuItem icon={<FolderPlus />} label="Folder" shortcut="⇧⌘N" onSelect={() => {}} />
            <MenuItem icon={<FilePlus />} label="File" onSelect={() => {}} />
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu modal={false}>
          <MenuTrigger
            label="Thinking mode"
            icon={<Brain />}
            value={model === "fast" ? "Fast" : "Deep"}
            variant="outline"
          />
          <DropdownMenuContent width="sm">
            <DropdownMenuRadioGroup value={model} onValueChange={setModel}>
              <DropdownMenuRadioItem value="fast" indicator="check">
                Fast
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="deep" indicator="check">
                Deep
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={showHidden} onCheckedChange={setShowHidden}>
              Show hidden files
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </GalleryRow>
      <GalleryRow label="Context menu">
        <ContextMenu>
          <ContextMenuTrigger className="grid h-20 w-72 place-items-center rounded-md border border-dashed border-charcoal-border text-xs text-cream-muted">
            Right-click here
          </ContextMenuTrigger>
          <ContextMenuContent width="md">
            <ContextMenuAction icon={<Copy />} label="Copy" shortcut="⌘C" onSelect={() => {}} />
            <ContextMenuAction icon={<Pencil />} label="Rename" onSelect={() => {}} />
            <ContextMenuSubmenu icon={<Share2 />} label="Share">
              <ContextMenuAction icon={<Copy />} label="Copy link" onSelect={() => {}} />
            </ContextMenuSubmenu>
            <ContextMenuSeparator />
            <ContextMenuAction icon={<Trash2 />} label="Delete" destructive onSelect={() => {}} />
          </ContextMenuContent>
        </ContextMenu>
      </GalleryRow>
    </GallerySection>
  );
}
