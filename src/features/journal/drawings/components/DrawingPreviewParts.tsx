import { ColorSwatch, CustomColorSwatch } from "@/shared/ui";
import type { ReactNode } from "react";

export const previewSurfaceColors = [
  "#101010",
  "#191b1f",
  "#122126",
  "#211e08",
  "#211b1b",
  "#f4f0e8",
];

/** Swatches for the preview's background, plus a custom color. */
export function BackgroundChoices(props: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="ml-auto flex shrink-0 items-center gap-1 pr-1">
      {previewSurfaceColors.map((color, index) => (
        <ColorSwatch
          key={color}
          shape="square"
          color={color}
          label={`Preview background ${index + 1}`}
          selected={props.value === color}
          onClick={() => props.onChange(color)}
        />
      ))}
      <CustomColorSwatch
        value={props.value}
        label="Custom preview background"
        title="Choose a custom preview background"
        onChange={props.onChange}
      />
    </div>
  );
}

export function PreviewMessage(props: { children: ReactNode }) {
  return (
    <div className="grid h-full place-items-center">
      <div className="flex items-center gap-2 text-xs text-cream-muted">{props.children}</div>
    </div>
  );
}

export function drawingExportFilename(title: string, extension: string): string {
  const safeTitle = title.trim().replace(/[\\/:*?"<>|]/g, "-") || "Untitled drawing";
  return `${safeTitle}.${extension}`;
}
