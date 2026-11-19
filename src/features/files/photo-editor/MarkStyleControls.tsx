import {
  ColorSwatch,
  CustomColorSwatch,
  DropdownMenu,
  DropdownMenuContent,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
  Switch,
  Text,
} from "@/shared/ui";
import type { MarkStyle, MarkupTool } from "./editorTypes";
import { markColors, nearestPreset, strokeSizes, textSizes, type Mark } from "./imageEdit";
import { PanelSection } from "./PhotoPanelView";
import { stickerById } from "./stickerCatalog";

/** Whether a mark takes a color: all but redactions, and of the stickers only shapes. */
const colored = (mark: Mark) =>
  mark.kind === "sticker" ? stickerById(mark.sticker)?.set === "shapes" : mark.kind !== "redact";

/** The colors a mark can be drawn in, and any other through the system's color picker. */
export function ColorChoices(props: { color: string; onColor: (color: string) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="Color"
      className="grid grid-cols-[repeat(auto-fill,minmax(1.75rem,1fr))] justify-items-center gap-2"
    >
      {markColors.map((option) => (
        <ColorSwatch
          key={option.value}
          radio
          color={option.value}
          label={option.label}
          selected={props.color.toLowerCase() === option.value}
          onClick={() => props.onColor(option.value)}
        />
      ))}
      <CustomColorSwatch value={props.color} label="Another color" onChange={props.onColor} />
    </div>
  );
}

/**
 * How marks look, for the picked marks or else the tool in hand: their color, line width, text
 * size and fill. Only what applies to them shows; nothing shows for the pointer, a redaction or a
 * flag.
 */
export function MarkStyleControls(props: {
  marks: Mark[];
  tool: MarkupTool;
  style: MarkStyle;
  onStyle: (style: Partial<MarkStyle>) => void;
}) {
  const { marks, style } = props;
  const kinds = new Set<string>(marks.length ? marks.map((mark) => mark.kind) : [props.tool]);
  const showsColor = marks.length
    ? marks.some(colored)
    : props.tool !== "redact" && props.tool !== "select";
  const showsStroke = ["pen", "line", "arrow", "rect", "ellipse"].some((kind) => kinds.has(kind));
  const showsText = kinds.has("text");
  const showsFill = kinds.has("rect") || kinds.has("ellipse");
  const tinted = marks.find(colored);
  const color = tinted ? tinted.color : style.color;
  const stroked = marks.find((mark) => !["text", "redact", "sticker"].includes(mark.kind));
  const stroke = stroked ? stroked.size : style.stroke;
  const text = marks.find((mark) => mark.kind === "text");
  const textSize = text ? text.size : style.text;
  const shape = marks.find(
    (mark): mark is Extract<Mark, { kind: "rect" | "ellipse" }> =>
      mark.kind === "rect" || mark.kind === "ellipse",
  );
  const fill = shape ? shape.fill : style.fill;
  const strokePreset = nearestPreset(strokeSizes, stroke);
  const textPreset = nearestPreset(textSizes, textSize);
  if (!showsColor && !showsStroke && !showsText && !showsFill) return null;
  return (
    <PanelSection title="Look">
      {showsColor ? (
        <ColorChoices color={color} onColor={(value) => props.onStyle({ color: value })} />
      ) : null}
      {showsStroke ? (
        <DropdownMenu>
          <MenuTrigger label="Line width" value={strokePreset.label} />
          <DropdownMenuContent width="sm" align="start">
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
          <DropdownMenuContent width="sm" align="start">
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
        <label className="flex items-center justify-between gap-3">
          <Text size="control" tone="default">
            Fill shape
          </Text>
          <Switch checked={fill} onCheckedChange={(checked) => props.onStyle({ fill: checked })} />
        </label>
      ) : null}
    </PanelSection>
  );
}
