// The deck themes' fonts, bundled with the app (all SIL OFL). Imported wherever a slide is drawn
// or measured, so each theme's type is there before its text is fitted.
import "@fontsource-variable/fraunces";
import "@fontsource-variable/inter";
import "@fontsource-variable/space-grotesk";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/400-italic.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import { themeFontFaces, type DeckTheme } from "./themes";

const loaded = new Map<string, Promise<void>>();

/** Resolves once a theme's fonts are ready to draw and measure with (or can't be loaded). */
export function loadThemeFonts(theme: DeckTheme): Promise<void> {
  const fonts = typeof document === "undefined" ? undefined : document.fonts;
  if (!fonts?.load) return Promise.resolve();
  let pending = loaded.get(theme.id);
  if (!pending) {
    pending = Promise.all(themeFontFaces(theme).map((face) => fonts.load(face).catch(() => [])))
      .then(() => undefined)
      .catch(() => undefined);
    loaded.set(theme.id, pending);
  }
  return pending;
}
