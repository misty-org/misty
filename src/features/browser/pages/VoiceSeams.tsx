import type { ComponentType } from "react";
import { createPort } from "@/shared/lib/seams";

/** The live subtitles toggle in More tools; voice sits above the browser and fills it in. */
export const liveSubtitlesMenuItem = createPort<
  ComponentType<{ onError: (error: unknown) => void }>
>("the live subtitles menu item");

export function LiveSubtitlesMenuItem(props: { onError: (error: unknown) => void }) {
  const Item = liveSubtitlesMenuItem.maybe();
  return Item ? <Item onError={props.onError} /> : null;
}
