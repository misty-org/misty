import {
  Button,
  ColorChip,
  ColorSwatch,
  CustomColorSwatch,
  DropdownMenu,
  DropdownMenuContent,
  IconButton,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
  ToolbarDivider,
} from "@/shared/ui";
import {
  ArrowUpRight,
  BringToFront,
  Circle,
  Copy,
  Crop,
  Grid3x3,
  Minus,
  MoreHorizontal,
  MousePointer2,
  PaintBucket,
  Pencil,
  Scaling,
  SendToBack,
  Square,
  Trash2,
  Type,
} from "lucide-react";
import { AdjustPopover } from "./AdjustPopover";
import { markupToolKeys, type MarkStyle, type MarkupTool } from "./editorTypes";
import {
  markColors,
  nearestPreset,
  strokeSizes,
  textSizes,
  type ImageEdit,
  type Mark,
} from "./imageEdit";
import type { ImageDocument } from "./useImageDocument";

const tools: { id: MarkupTool; label: string; icon: typeof Pencil }[] = [
  { id: "select", label: "Select", icon: MousePointer2 },
  { id: "pen", label: "Pen", icon: Pencil },
  { id: "line", label: "Line", icon: Minus },
  { id: "arrow", label: "Arrow", icon: ArrowUpRight },
  { id: "rect", label: "Rectangle", icon: Square },
  { id: "ellipse", label: "Ellipse", icon: Circle },
  { id: "text", label: "Text", icon: Type },
  { id: "redact", label: "Redact", icon: Grid3x3 },
];

export interface MarkupBarProps {
  edit: ImageEdit;
  document: Pick<ImageDocument, "change" | "preview" | "commit">;
  tool: MarkupTool;
  onTool: (tool: MarkupTool) => void;
  style: MarkStyle;
  /** Sets how new marks look, and restyles the picked marks to match. */
  onStyle: (style: Partial<MarkStyle>) => void;
  selection: Mark[];
  onDuplicate: () => void;
  onDelete: () => void;
  onArrange: (to: "front" | "back") => void;
  onEditText: () => void;
  onCrop: () => void;
  onResize: () => void;
  onAuto: () => void;
}

/**
 * The markup row under the top bar, as Preview's: the drawing tools, how marks look, then crop,
 * color and size. It shows only while markup is on; what applies to the tool in hand or the
 * picked marks shows, nothing else.
 */
export function MarkupBar(props: MarkupBarProps) {
  const { tool, style, selection } = props;
  const lead = selection[0];
  // What the style controls apply to: the picked marks, or else the tool in hand.
  const kinds = new Set<string>(selection.length ? selection.map((mark) => mark.kind) : [tool]);
  const showsColor = [...kinds].some((kind) => kind !== "redact" && kind !== "select");
  const showsStroke = ["pen", "line", "arrow", "rect", "ellipse"].some((kind) => kinds.has(kind));
  const showsText = kinds.has("text");
  const showsFill = kinds.has("rect") || kinds.has("ellipse");
  const color = lead && lead.kind !== "redact" ? lead.color : style.color;
  const stroke = lead && lead.kind !== "text" && lead.kind !== "redact" ? lead.size : style.stroke;
  const textSize = lead?.kind === "text" ? lead.size : style.text;
  const fill = lead && (lead.kind === "rect" || lead.kind === "ellipse") ? lead.fill : style.fill;
  const strokePreset = nearestPreset(strokeSizes, stroke);
  const textPreset = nearestPreset(textSizes, textSize);

  return (
    <div
      role="toolbar"
      aria-label="Markup"
      className="flex h-11 min-w-0 shrink-0 items-center gap-1 overflow-hidden px-3"
    >
      {tools.map((option) => {
        const Icon = option.icon;
        return (
          <IconButton
            key={option.id}
            label={option.label}
            shortcut={markupToolKeys[option.id]}
            aria-pressed={tool === option.id}
            onClick={() => props.onTool(option.id)}
          >
            <Icon />
          </IconButton>
        );
      })}

      {showsColor || showsStroke || showsText || showsFill ? <ToolbarDivider /> : null}
      {showsColor ? (
        <Popover>
          <PopoverTrigger asChild>
            <IconButton label="Color">
              <ColorChip color={color} className="size-4" />
            </IconButton>
          </PopoverTrigger>
          <PopoverContent size="sm" side="bottom" align="start">
            <PopoverHeader title="Color" />
            <PopoverBody>
              <div role="radiogroup" aria-label="Color" className="flex items-center gap-2">
                {markColors.map((option) => (
                  <ColorSwatch
                    key={option.value}
                    radio
                    color={option.value}
                    label={option.label}
                    selected={color.toLowerCase() === option.value}
                    onClick={() => props.onStyle({ color: option.value })}
                  />
                ))}
                <CustomColorSwatch
                  value={color}
                  label="Another color"
                  onChange={(value) => props.onStyle({ color: value })}
                />
              </div>
            </PopoverBody>
          </PopoverContent>
        </Popover>
      ) : null}
      {showsStroke ? (
        <DropdownMenu>
          <MenuTrigger label="Stroke" value={strokePreset.label} />
          <DropdownMenuContent width="sm">
            <MenuRadioGroup
              value={strokePreset.id}
              onValueChange={(id) =>
                props.onStyle({
                  stroke: strokeSizes.find((size) => size.id === id)?.value ?? style.stroke,
                })
              }
            >
              {strokeSizes.map((size) => (
                <MenuRadioItem key={size.id} value={size.id} label={size.label} />
              ))}
            </MenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {showsText ? (
        <DropdownMenu>
          <MenuTrigger label="Text size" value={textPreset.label} />
          <DropdownMenuContent width="sm">
            <MenuRadioGroup
              value={textPreset.id}
              onValueChange={(id) =>
                props.onStyle({
                  text: textSizes.find((size) => size.id === id)?.value ?? style.text,
                })
              }
            >
              {textSizes.map((size) => (
                <MenuRadioItem key={size.id} value={size.id} label={size.label} />
              ))}
            </MenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {showsFill ? (
        <IconButton
          label="Fill shape"
          aria-pressed={fill}
          onClick={() => props.onStyle({ fill: !fill })}
        >
          <PaintBucket />
        </IconButton>
      ) : null}

      <ToolbarDivider />
      <IconButton label="Crop" shortcut="C" onClick={props.onCrop}>
        <Crop />
      </IconButton>
      <AdjustPopover edit={props.edit} document={props.document} onAuto={props.onAuto} />
      <IconButton label="Resize image" onClick={props.onResize}>
        <Scaling />
      </IconButton>

      <div className="flex-1" />
      {selection.length ? (
        <DropdownMenu>
          <MenuTrigger
            iconOnly
            icon={MoreHorizontal}
            label={
              selection.length === 1 ? "Mark actions" : `Actions for ${selection.length} marks`
            }
          />
          <DropdownMenuContent align="end" width="md">
            {selection.length === 1 && lead?.kind === "text" ? (
              <MenuItem icon={Type} label="Edit text" onSelect={props.onEditText} />
            ) : null}
            <MenuItem icon={Copy} label="Duplicate" shortcut="⌘D" onSelect={props.onDuplicate} />
            <MenuItem
              icon={BringToFront}
              label="Bring to front"
              onSelect={() => props.onArrange("front")}
            />
            <MenuItem
              icon={SendToBack}
              label="Send to back"
              onSelect={() => props.onArrange("back")}
            />
            <MenuSeparator />
            <MenuItem icon={Trash2} label="Delete" shortcut="⌫" danger onSelect={props.onDelete} />
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

/** The row while cropping: start over, or leave the crop as it was, or keep what the box holds. */
export function CropBar(props: {
  changed: boolean;
  onReset: () => void;
  onCancel: () => void;
  onApply: () => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Crop"
      className="flex h-11 min-w-0 shrink-0 items-center gap-1 overflow-hidden px-3"
    >
      {props.changed ? (
        <Button variant="quiet" onClick={props.onReset}>
          Reset
        </Button>
      ) : null}
      <div className="flex-1" />
      <Button variant="quiet" onClick={props.onCancel}>
        Cancel
      </Button>
      <Button variant="secondary" onClick={props.onApply}>
        Crop
      </Button>
    </div>
  );
}
