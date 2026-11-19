import { ChoiceTile } from "@/shared/ui";
import { ArrowUpRight, Circle, Grid3x3, Minus, MousePointer2, Pencil, Square } from "lucide-react";
import { markupToolKeys, type MarkStyle, type MarkupTool } from "./editorTypes";
import { MarkStyleControls } from "./MarkStyleControls";
import { PanelSection, PhotoPanelView } from "./PhotoPanelView";

/** Text has its own tab, so it isn't among these. */
const tools: { id: Exclude<MarkupTool, "text">; label: string; icon: typeof Pencil }[] = [
  { id: "select", label: "Select", icon: MousePointer2 },
  { id: "pen", label: "Pen", icon: Pencil },
  { id: "line", label: "Line", icon: Minus },
  { id: "arrow", label: "Arrow", icon: ArrowUpRight },
  { id: "rect", label: "Rectangle", icon: Square },
  { id: "ellipse", label: "Ellipse", icon: Circle },
  { id: "redact", label: "Redact", icon: Grid3x3 },
];

/**
 * The Markup tab: drawing on the image, as Preview's markup tools (each with its letter key), and
 * how the next mark looks. A picked mark's own look is in the properties panel.
 */
export function MarkupPanel(props: {
  tool: MarkupTool;
  onTool: (tool: MarkupTool) => void;
  style: MarkStyle;
  onStyle: (style: Partial<MarkStyle>) => void;
}) {
  return (
    <PhotoPanelView title="Markup">
      <PanelSection title="Tools">
        <div role="radiogroup" aria-label="Markup tool" className="grid grid-cols-4 gap-1">
          {tools.map((option) => {
            const Icon = option.icon;
            return (
              <ChoiceTile
                key={option.id}
                radio
                label={`${option.label} (${markupToolKeys[option.id]})`}
                caption={option.label}
                selected={props.tool === option.id}
                onSelect={() => props.onTool(option.id)}
              >
                <Icon />
              </ChoiceTile>
            );
          })}
        </div>
      </PanelSection>
      <MarkStyleControls marks={[]} tool={props.tool} style={props.style} onStyle={props.onStyle} />
    </PhotoPanelView>
  );
}
