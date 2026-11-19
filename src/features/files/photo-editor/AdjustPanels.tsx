import { useMemo } from "react";
import { Button, ChoiceTile } from "@/shared/ui";
import {
  adjustmentIds,
  defaultImageEdit,
  filterIds,
  noAdjustments,
  type AdjustmentId,
  type FilterId,
  type ImageEdit,
} from "./imageEdit";
import { renderPhoto, workingCopy, type PhotoSource } from "./imageRender";
import { PanelSection, PanelSlider, PhotoPanelView } from "./PhotoPanelView";
import type { ImageDocument } from "./useImageDocument";

type EditDocument = Pick<ImageDocument, "change" | "preview" | "commit">;

/** The adjustments, in the groups Photos and Lightroom use. */
const groups: { title: string; sliders: { id: AdjustmentId; label: string }[] }[] = [
  {
    title: "Light",
    sliders: [
      { id: "exposure", label: "Exposure" },
      { id: "brightness", label: "Brightness" },
      { id: "contrast", label: "Contrast" },
      { id: "highlights", label: "Highlights" },
      { id: "shadows", label: "Shadows" },
    ],
  },
  {
    title: "Color",
    sliders: [
      { id: "saturation", label: "Saturation" },
      { id: "vibrance", label: "Vibrance" },
      { id: "warmth", label: "Warmth" },
      { id: "tint", label: "Tint" },
    ],
  },
  {
    title: "Detail",
    sliders: [
      { id: "sharpness", label: "Sharpness" },
      { id: "vignette", label: "Vignette" },
    ],
  },
];

/** The Adjust tab: light, color and detail, each a slider the image follows as it moves. */
export function AdjustPanel(props: {
  edit: ImageEdit;
  document: EditDocument;
  onAuto: () => void;
}) {
  const { edit, document } = props;
  const adjusted = adjustmentIds.some((id) => edit.adjust[id] !== 0);
  return (
    <PhotoPanelView
      title="Adjust"
      actions={
        <>
          {adjusted ? (
            <Button
              size="sm"
              variant="quiet"
              onClick={() => document.change((current) => ({ ...current, adjust: noAdjustments }))}
            >
              Reset
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" onClick={props.onAuto}>
            Auto
          </Button>
        </>
      }
    >
      {groups.map((group) => (
        <PanelSection key={group.title} title={group.title}>
          {group.sliders.map((slider) => (
            <PanelSlider
              key={slider.id}
              label={slider.label}
              value={edit.adjust[slider.id]}
              onPreview={(value) =>
                document.preview((current) => ({
                  ...current,
                  adjust: { ...current.adjust, [slider.id]: value },
                }))
              }
              onCommit={document.commit}
            />
          ))}
        </PanelSection>
      ))}
    </PhotoPanelView>
  );
}

const filterNames: Record<FilterId, string> = {
  none: "None",
  vivid: "Vivid",
  dramatic: "Dramatic",
  warm: "Warm",
  cool: "Cool",
  fade: "Fade",
  mono: "Mono",
  noir: "Noir",
};

/** Each filter over a small copy of the photo as it came, drawn once per photo. */
function useFilterPreviews(photo: PhotoSource) {
  return useMemo(() => {
    const small = workingCopy(photo, 160);
    return Object.fromEntries(
      filterIds.map((id) => {
        const { canvas } = renderPhoto(
          small,
          { ...defaultImageEdit, filter: id },
          { maxSide: 160 },
        );
        return [id, canvas.toDataURL("image/jpeg", 0.8)];
      }),
    ) as Record<FilterId, string>;
  }, [photo]);
}

/** The Filters tab: a look for the whole image, shown over the photo itself, and how strong. */
export function FiltersPanel(props: {
  photo: PhotoSource;
  edit: ImageEdit;
  document: EditDocument;
}) {
  const { edit, document } = props;
  const previews = useFilterPreviews(props.photo);
  return (
    <PhotoPanelView title="Filters">
      <div role="radiogroup" aria-label="Filter" className="grid grid-cols-2 gap-2">
        {filterIds.map((id) => (
          <ChoiceTile
            key={id}
            radio
            label={filterNames[id]}
            caption={filterNames[id]}
            selected={edit.filter === id}
            onSelect={() =>
              document.change((current) => ({ ...current, filter: id, filterStrength: 100 }))
            }
          >
            <img
              src={previews[id]}
              alt=""
              className="aspect-square w-full rounded-sm object-cover"
            />
          </ChoiceTile>
        ))}
      </div>
      {edit.filter === "none" ? null : (
        <PanelSlider
          label="Strength"
          value={edit.filterStrength}
          min={0}
          max={100}
          rest={100}
          unit="%"
          onPreview={(value) =>
            document.preview((current) => ({ ...current, filterStrength: value }))
          }
          onCommit={document.commit}
        />
      )}
    </PhotoPanelView>
  );
}
