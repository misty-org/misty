import { ChoiceTile, SearchField, Text } from "@misty/ui";
import { useMemo, useState } from "react";
import { stickerDragType } from "./editorTypes";
import { ColorChoices } from "./MarkStyleControls";
import { PanelSection, PhotoPanelView } from "./PhotoPanelView";
import { findStickers, stickerSets, type Sticker } from "./stickerCatalog";
import { stickerPreview } from "./stickers";

/**
 * The Stickers tab: OpenCut's sticker sets (its shapes and flags), found by name. A click puts a
 * sticker in the middle of the image and a drag puts it where it is let go; either way it is
 * picked, to move, size and fade. Shapes take the color picked here.
 */
export function StickersPanel(props: {
  color: string;
  onColor: (color: string) => void;
  onPlace: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const found = useMemo(
    () => stickerSets.map((set) => ({ ...set, stickers: findStickers(set.id, search) })),
    [search],
  );
  // Shapes are drawn in the color they'll take; flags keep their own.
  const shapePreviews = useMemo(
    () =>
      new Map(
        findStickers("shapes", "").map((sticker) => [
          sticker.id,
          stickerPreview(sticker, props.color),
        ]),
      ),
    [props.color],
  );
  const nothing = found.every((set) => !set.stickers.length);
  return (
    <PhotoPanelView title="Stickers">
      <SearchField
        aria-label="Search stickers"
        placeholder="Search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        onClear={() => setSearch("")}
      />
      {nothing ? (
        <Text as="p" size="control" tone="muted" wrap>
          No stickers match.
        </Text>
      ) : null}
      {found.map((set) =>
        set.stickers.length ? (
          <PanelSection key={set.id} title={set.name}>
            <div role="group" aria-label={set.name} className="grid grid-cols-4 gap-1">
              {set.stickers.map((sticker) => (
                <StickerTile
                  key={sticker.id}
                  sticker={sticker}
                  preview={shapePreviews.get(sticker.id) ?? stickerPreview(sticker, props.color)}
                  onPlace={props.onPlace}
                />
              ))}
            </div>
            {set.id === "shapes" ? (
              <ColorChoices color={props.color} onColor={props.onColor} />
            ) : null}
          </PanelSection>
        ) : null,
      )}
    </PhotoPanelView>
  );
}

function StickerTile(props: { sticker: Sticker; preview: string; onPlace: (id: string) => void }) {
  const { sticker } = props;
  return (
    <ChoiceTile
      label={sticker.name}
      selected={false}
      draggable
      onSelect={() => props.onPlace(sticker.id)}
      onDragStart={(event) => {
        event.dataTransfer.setData(stickerDragType, sticker.id);
        event.dataTransfer.setData("text/plain", sticker.name);
        event.dataTransfer.effectAllowed = "copy";
      }}
    >
      <img
        src={props.preview}
        alt=""
        draggable={false}
        loading="lazy"
        className="aspect-square w-full object-contain"
      />
    </ChoiceTile>
  );
}
