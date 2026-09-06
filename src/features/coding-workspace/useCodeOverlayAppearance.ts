import { useEffect } from "react";
import type { EditorPreferences } from "@/features/settings";

type Appearance = Pick<EditorPreferences, "theme" | "interfaceScale">;
const owners = new Map<symbol, Appearance>();
let original: { theme?: string; scale?: string } | undefined;
/** Portals share the document theme; one Code view closing must not clear another's. */
export function useCodeOverlayAppearance(appearance: Appearance) {
  const { theme, interfaceScale } = appearance;
  useEffect(() => {
    const data = document.documentElement.dataset;
    if (!owners.size) original = { theme: data.codeOverlayTheme, scale: data.codeOverlayScale };
    const owner = Symbol();
    owners.set(owner, { theme, interfaceScale });
    data.codeOverlayTheme = theme;
    data.codeOverlayScale = String(interfaceScale);
    return () => {
      owners.delete(owner);
      const current = [...owners.values()][owners.size - 1];
      const theme = current?.theme ?? original?.theme;
      const scale = current ? String(current.interfaceScale) : original?.scale;
      if (theme === undefined) delete data.codeOverlayTheme;
      else data.codeOverlayTheme = theme;
      if (scale === undefined) delete data.codeOverlayScale;
      else data.codeOverlayScale = scale;
      if (!owners.size) original = undefined;
    };
  }, [theme, interfaceScale]);
}
