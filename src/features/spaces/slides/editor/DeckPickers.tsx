import { ChoiceTile, Surface } from "@/shared/ui";
import { SLIDE_HEIGHT, SLIDE_WIDTH, slideLayouts, type SlotSpec } from "../deck/layouts";
import { deckThemeList, fontStack, screenColor } from "../deck/themes";
import { slideLayoutIds, type DeckThemeId, type SlideLayoutId } from "../deck/types";

/** The 3×3 grid of layouts, each drawn as a wireframe of its slots. */
export function LayoutPicker(props: {
  value: SlideLayoutId | null;
  onPick(layout: SlideLayoutId): void;
}) {
  return (
    <div role="radiogroup" aria-label="Layouts" className="grid grid-cols-3 gap-1">
      {slideLayoutIds.map((id) => (
        <ChoiceTile
          key={id}
          radio
          label={slideLayouts[id].name}
          caption={slideLayouts[id].name}
          selected={props.value === id}
          onSelect={() => props.onPick(id)}
        >
          <Surface
            tone="well"
            edge="hairline"
            radius="sm"
            className="relative aspect-video w-full overflow-hidden"
          >
            {slideLayouts[id].slots.map((slot) => (
              <Wire key={slot.name} slot={slot} />
            ))}
          </Surface>
        </ChoiceTile>
      ))}
    </div>
  );
}

function Wire({ slot }: { slot: SlotSpec }) {
  const place = {
    left: `${(slot.box.x / SLIDE_WIDTH) * 100}%`,
    top: `${(slot.box.y / SLIDE_HEIGHT) * 100}%`,
    width: `${(slot.box.w / SLIDE_WIDTH) * 100}%`,
    height: `${(slot.box.h / SLIDE_HEIGHT) * 100}%`,
  };
  if (slot.kind === "visual")
    return <Surface tone="track" radius="sm" className="absolute" style={place} />;
  const lines = slot.bullets ? 3 : 1;
  const heading = slot.font === "heading";
  return (
    <div
      className="absolute flex flex-col gap-0.5"
      style={{
        ...place,
        justifyContent:
          slot.valign === "end" ? "flex-end" : slot.valign === "center" ? "center" : "flex-start",
        alignItems: slot.align === "center" ? "center" : "flex-start",
      }}
    >
      {Array.from({ length: lines }, (_, index) => (
        <Surface
          key={index}
          tone="track"
          radius="full"
          className={heading ? "h-1.5" : "h-1"}
          style={{ width: index === lines - 1 && lines > 1 ? "55%" : heading ? "70%" : "85%" }}
        />
      ))}
    </div>
  );
}

/** The six themes as "Aa" cards in their own type and colors. */
export function ThemePicker(props: { value: DeckThemeId; onPick(theme: DeckThemeId): void }) {
  return (
    <div role="radiogroup" aria-label="Themes" className="grid grid-cols-3 gap-1">
      {deckThemeList.map((theme) => (
        <ChoiceTile
          key={theme.id}
          radio
          label={theme.name}
          caption={theme.name}
          selected={props.value === theme.id}
          onSelect={() => props.onPick(theme.id)}
        >
          <Surface
            edge="hairline"
            radius="sm"
            className="relative aspect-video w-full overflow-hidden"
          >
            <div
              aria-hidden="true"
              className="absolute inset-0 flex flex-col justify-center px-3"
              style={{
                background: screenColor(theme, "background"),
                color: screenColor(theme, "text"),
              }}
            >
              <span
                style={{
                  fontFamily: fontStack(theme.heading),
                  fontWeight: theme.headingWeight,
                  fontSize: "1.375rem",
                  lineHeight: 1,
                }}
              >
                Aa
              </span>
              <span
                className="mt-1.5 h-1 w-2/5 rounded-full"
                style={{ background: screenColor(theme, "accent") }}
              />
            </div>
          </Surface>
        </ChoiceTile>
      ))}
    </div>
  );
}
