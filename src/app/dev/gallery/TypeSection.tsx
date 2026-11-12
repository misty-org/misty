import { OverflowFadeText, Text, type TextSize, type TextTone, type TextWeight } from "@/shared/ui";
import { GalleryRow, GallerySection } from "./GalleryLayout";

const sizes: ReadonlyArray<{ size: TextSize; px: number; use: string }> = [
  { size: "caption", px: 12, use: "Badges and shortcut text" },
  { size: "meta", px: 13, use: "Times, counts, the path line, tooltips" },
  { size: "control", px: 14, use: "Every button, field, menu row and list row" },
  { size: "body", px: 15, use: "Messages, notes and prose" },
  { size: "page", px: 16, use: "Page text and empty state titles" },
  { size: "title", px: 18, use: "Dialog and page titles" },
];

const tones: ReadonlyArray<TextTone> = ["default", "muted", "bright", "danger"];
const weights: ReadonlyArray<TextWeight> = ["regular", "medium", "semibold"];

const longName = "misty-org/misty/src/features/agents/virtual/studio/panels/AgentsInTheRoom.tsx";

export function TypeSection() {
  return (
    <GallerySection title="Type and long text">
      {sizes.map((item) => (
        <GalleryRow key={item.size} label={`${item.size} · ${item.px}px`}>
          <Text size={item.size}>{item.use}</Text>
        </GalleryRow>
      ))}
      <GalleryRow label="Tones">
        {tones.map((tone) => (
          <Text key={tone} size="control" tone={tone}>
            {tone}
          </Text>
        ))}
      </GalleryRow>
      <GalleryRow label="Weights">
        {weights.map((weight) => (
          <Text key={weight} size="control" weight={weight}>
            {weight}
          </Text>
        ))}
      </GalleryRow>
      <GalleryRow label="Fades, one line">
        <div className="w-64">
          <Text size="control" full>
            {longName}
          </Text>
        </div>
      </GalleryRow>
      <GalleryRow label="Fades, two lines">
        <div className="w-64">
          <OverflowFadeText lines={2} full className="text-control">
            A card title that is long enough to wrap onto a second line and still run out of room at
            the end of it
          </OverflowFadeText>
        </div>
      </GalleryRow>
      <GalleryRow label="Fits, no fade">
        <div className="w-64">
          <Text size="control">Short name</Text>
        </div>
      </GalleryRow>
    </GallerySection>
  );
}
