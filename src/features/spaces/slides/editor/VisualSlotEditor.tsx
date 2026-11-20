import { Crop, FolderOpen, HardDrive, ImagePlus, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  MenuItem,
  MenuSeparator,
  MenuSubmenu,
  Pressable,
  spaceIcons,
} from "@misty/ui";
import type { ItemVisibility } from "../../api/visibility";
import type { VisualSlotSpec } from "../deck/layouts";
import type { DeckTheme } from "../deck/themes";
import type { SlotEmbed } from "../deck/types";
import { boxStyle, reactStyle } from "../deck/slotStyle";
import { VisualSlot } from "../render/VisualSlot";

export type VisualSource = "computer" | "library" | "chart" | "frame";

/** A visual slot in the editor: the visual itself, and a click on it to replace or remove it. */
export function VisualSlotEditor(props: {
  spec: VisualSlotSpec;
  embed: SlotEmbed | null;
  theme: DeckTheme;
  spaceId: string;
  deckId: string;
  hostVisibility: ItemVisibility;
  onPick(source: VisualSource): void;
  onCrop(): void;
  onRemove(): void;
}) {
  const { embed } = props;
  return (
    <>
      <VisualSlot
        spec={props.spec}
        embed={embed}
        theme={props.theme}
        spaceId={props.spaceId}
        deckId={props.deckId}
        hostVisibility={props.hostVisibility}
        embedMode="live"
        showEmpty
      />
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Pressable
            aria-label={embed ? "Replace the visual" : "Add a visual"}
            style={{ ...reactStyle(boxStyle(props.spec.box)), zIndex: 1 }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" width="md">
          <MenuSubmenu icon={ImagePlus} label="Image">
            <MenuItem
              icon={HardDrive}
              label="From this computer"
              onSelect={() => props.onPick("computer")}
            />
            <MenuItem
              icon={FolderOpen}
              label="From Space media"
              onSelect={() => props.onPick("library")}
            />
          </MenuSubmenu>
          <MenuItem
            icon={spaceIcons.data}
            label="Chart from Data"
            onSelect={() => props.onPick("chart")}
          />
          <MenuItem
            icon={spaceIcons.whiteboards}
            label="Whiteboard frame"
            onSelect={() => props.onPick("frame")}
          />
          {embed ? <MenuSeparator /> : null}
          {embed?.type === "image" ? (
            <MenuItem icon={Crop} label="Adjust crop" onSelect={props.onCrop} />
          ) : null}
          {embed ? (
            <MenuItem icon={Trash2} label="Remove" danger onSelect={props.onRemove} />
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
