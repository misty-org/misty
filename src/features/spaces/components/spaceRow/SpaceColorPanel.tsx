import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { setSpaceColor, useSpaceWindowStore } from "@/features/workspace/spaceWindow";
import {
  isWindowColor,
  windowColorHex,
  windowColorNames,
  windowColors,
  type WindowColor,
} from "@/features/workspace/windowColors";
import { Input, Pressable } from "@/shared/ui";

const swatch = "relative grid size-7 place-items-center rounded-full text-black";
const SAVE_DELAY_MS = 250;

/**
 * The Space's color picker: the palette plus a custom color. A color applies the moment it
 * is picked (a custom one once the picker settles), and is saved without a button.
 */
export function SpaceColorPanel() {
  const space = useSpaceWindowStore((state) => state.space);
  const [failed, setFailed] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<WindowColor | undefined>(undefined);

  const flush = () => {
    window.clearTimeout(timer.current);
    const color = pending.current;
    pending.current = undefined;
    if (!color) return;
    setFailed(false);
    setSpaceColor(color).catch(() => setFailed(true));
  };
  const choose = (color: WindowColor, immediate: boolean) => {
    useSpaceWindowStore.setState((state) =>
      state.space ? { space: { ...state.space, color } } : state,
    );
    pending.current = color;
    window.clearTimeout(timer.current);
    if (immediate) flush();
    else timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
  };
  // Closing the panel saves a color still waiting on the custom picker.
  useEffect(() => flush, []);

  const chosen = space?.color;
  const custom = chosen?.startsWith("#") ?? false;
  return (
    <div>
      <p className="m-0 text-sm font-medium text-cream">Space color</p>
      <p className="mb-0 mt-1 text-xs text-cream-muted">
        Tints this window's frame and tabs. Page content stays as it is.
      </p>
      <div role="radiogroup" aria-label="Space color" className="flex justify-between pt-4">
        {windowColorNames.map((name) => (
          <Pressable
            key={name}
            type="button"
            role="radio"
            aria-label={name}
            aria-checked={chosen === name}
            className={swatch}
            style={{ backgroundColor: windowColors[name] }}
            onClick={() => choose(name, true)}
          >
            {chosen === name ? <Check aria-hidden className="size-3.5" strokeWidth={3} /> : null}
          </Pressable>
        ))}
        <label
          className={`${swatch} cursor-pointer`}
          aria-label="Custom color"
          style={
            custom && chosen
              ? { backgroundColor: windowColorHex(chosen) }
              : {
                  background:
                    "conic-gradient(#f28b82, #fdd663, #81c995, #78d9ec, #8ab4f8, #c58af9, #ff8bcb, #f28b82)",
                }
          }
        >
          {custom ? <Check aria-hidden className="size-3.5" strokeWidth={3} /> : null}
          <Input
            type="color"
            variant="bare"
            aria-label="Custom color"
            value={custom && chosen ? windowColorHex(chosen) : "#8ab4f8"}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
            onChange={(event) => {
              const value = event.target.value.toLowerCase();
              if (isWindowColor(value)) choose(value, false);
            }}
          />
        </label>
      </div>
      {failed && (
        <p role="alert" className="mb-0 mt-3 text-xs text-cream">
          The color wasn't saved. Try again.
        </p>
      )}
    </div>
  );
}
