import { Button, IconButton, PropertyList } from "@/shared/ui";
import { BringToFront, Copy, SendToBack, Trash2 } from "lucide-react";
import type { MarkStyle, MarkupTool } from "./editorTypes";
import { outputSize, type ImageEdit, type Mark } from "./imageEdit";
import { MarkStyleControls } from "./MarkStyleControls";
import { PanelSection, PanelSlider, PhotoPanelView } from "./PhotoPanelView";
import { stickerById } from "./stickerCatalog";

const kindNames: Record<Mark["kind"], string> = {
  pen: "Drawing",
  line: "Line",
  arrow: "Arrow",
  rect: "Rectangle",
  ellipse: "Ellipse",
  text: "Text",
  redact: "Redaction",
  sticker: "Sticker",
};

/** A picked mark's name: a sticker by its own (a flag's country, a shape's name). */
function markName(mark: Mark) {
  return mark.kind === "sticker"
    ? (stickerById(mark.sticker)?.name ?? kindNames.sticker)
    : kindNames[mark.kind];
}

const formatNames: Record<string, string> = {
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/webp": "WebP",
};

/**
 * The properties panel, as OpenCut's: what is picked in the image (its look, stacking, duplicate
 * and delete), or, with nothing picked, the image itself.
 */
export function PhotoProperties(props: {
  edit: ImageEdit;
  natural: { width: number; height: number };
  mimeType: string;
  picked: Mark[];
  tool: MarkupTool;
  style: MarkStyle;
  readonly: boolean;
  onStyle: (style: Partial<MarkStyle>) => void;
  /** The picked stickers' opacity, 0 to 1, as its slider moves, and when it lets go. */
  onFade: (opacity: number) => void;
  onFadeDone: () => void;
  onEditText: () => void;
  onDuplicate: () => void;
  onArrange: (to: "front" | "back") => void;
  onDelete: () => void;
}) {
  const { picked, natural, edit } = props;
  if (!picked.length || props.readonly) {
    const saved = outputSize(natural, edit);
    const same = saved.width === natural.width && saved.height === natural.height;
    return (
      <PhotoPanelView title="Image">
        <PropertyList
          label="Image details"
          layout="stacked"
          items={[
            { label: "Size", value: `${natural.width} × ${natural.height} pixels` },
            ...(same
              ? []
              : [{ label: "Saves at", value: `${saved.width} × ${saved.height} pixels` }]),
            { label: "Format", value: formatNames[props.mimeType] ?? "PNG" },
          ]}
        />
      </PhotoPanelView>
    );
  }
  const lead = picked[0];
  const title = picked.length === 1 ? markName(lead) : `${picked.length} marks`;
  const stickers = picked.every((mark) => mark.kind === "sticker");
  return (
    <PhotoPanelView
      title={title}
      actions={
        <>
          <IconButton label="Duplicate" shortcut="⌘D" onClick={props.onDuplicate}>
            <Copy />
          </IconButton>
          <IconButton label="Delete" shortcut="⌫" onClick={props.onDelete}>
            <Trash2 />
          </IconButton>
        </>
      }
    >
      <MarkStyleControls
        marks={picked}
        tool={props.tool}
        style={props.style}
        onStyle={props.onStyle}
      />
      {stickers && lead.kind === "sticker" ? (
        <PanelSlider
          label="Opacity"
          value={Math.round(lead.opacity * 100)}
          min={5}
          max={100}
          rest={100}
          unit="%"
          onPreview={(value) => props.onFade(value / 100)}
          onCommit={props.onFadeDone}
        />
      ) : null}
      <PanelSection title="Arrange">
        <div className="flex items-center gap-1">
          <IconButton label="Bring to front" onClick={() => props.onArrange("front")}>
            <BringToFront />
          </IconButton>
          <IconButton label="Send to back" onClick={() => props.onArrange("back")}>
            <SendToBack />
          </IconButton>
        </div>
      </PanelSection>
      {picked.length === 1 && lead.kind === "text" ? (
        <Button variant="secondary" onClick={props.onEditText}>
          Edit text
        </Button>
      ) : null}
    </PhotoPanelView>
  );
}
