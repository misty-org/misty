import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  IconButton,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "@/shared/ui";
import { FlipHorizontal2, FlipVertical2, RotateCcw, RotateCw } from "lucide-react";
import { aspectIds, type AspectId, type ImageEdit } from "./imageEdit";
import { PanelSection, PanelSlider, PhotoPanelView } from "./PhotoPanelView";
import type { ImageDocument } from "./useImageDocument";

const aspectNames: Record<AspectId, string> = {
  free: "Freeform",
  original: "Original",
  square: "Square",
  "4:3": "4:3",
  "3:2": "3:2",
  "16:9": "16:9",
};

/**
 * The Crop tab: the crop frame is on the image while it is open. Its shape, the image's
 * straightening, and turning and mirroring it; Crop (or Enter, or another tab) keeps the frame.
 */
export function CropPanel(props: {
  edit: ImageEdit;
  document: Pick<ImageDocument, "preview" | "commit">;
  aspect: AspectId;
  onAspect: (aspect: AspectId) => void;
  /** Whether the frame holds less than the whole image. */
  changed: boolean;
  onReset: () => void;
  onApply: () => void;
  onTurn: (clockwise: boolean) => void;
  onMirror: (axis: "x" | "y") => void;
}) {
  const { edit, document } = props;
  return (
    <PhotoPanelView
      title="Crop"
      actions={
        <>
          {props.changed ? (
            <Button size="sm" variant="quiet" onClick={props.onReset}>
              Reset
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" onClick={props.onApply}>
            Crop
          </Button>
        </>
      }
    >
      <PanelSection title="Shape">
        <DropdownMenu>
          <MenuTrigger label="Aspect ratio" value={aspectNames[props.aspect]} />
          <DropdownMenuContent width="sm" align="start">
            <MenuRadioGroup
              value={props.aspect}
              onValueChange={(value) => props.onAspect(value as AspectId)}
            >
              {aspectIds.map((id) => (
                <MenuRadioItem key={id} value={id} label={aspectNames[id]} />
              ))}
            </MenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <PanelSlider
          label="Straighten"
          value={edit.straighten}
          min={-45}
          max={45}
          unit="°"
          onPreview={(value) => document.preview((current) => ({ ...current, straighten: value }))}
          onCommit={document.commit}
        />
      </PanelSection>
      <PanelSection title="Turn and mirror">
        <div className="flex items-center gap-1">
          <IconButton label="Rotate left" shortcut="⇧⌘R" onClick={() => props.onTurn(false)}>
            <RotateCcw />
          </IconButton>
          <IconButton label="Rotate right" shortcut="⌘R" onClick={() => props.onTurn(true)}>
            <RotateCw />
          </IconButton>
          <IconButton
            label="Mirror left to right"
            aria-pressed={edit.flipX}
            onClick={() => props.onMirror("x")}
          >
            <FlipHorizontal2 />
          </IconButton>
          <IconButton
            label="Mirror top to bottom"
            aria-pressed={edit.flipY}
            onClick={() => props.onMirror("y")}
          >
            <FlipVertical2 />
          </IconButton>
        </div>
      </PanelSection>
    </PhotoPanelView>
  );
}
