import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { currentProfile, setProfileColor, useProfileWindowStore } from "./profileWindow";
import {
  isWindowColor,
  windowColorHex,
  windowColorNames,
  windowColors,
  type WindowColor,
} from "./windowColors";
import { ErrorNotification, Input, Pressable } from "@/shared/ui";
import { useDialogProfile } from "./profileDialogStore";

const swatch = "relative grid size-7 place-items-center rounded-full text-black";
const SAVE_DELAY_MS = 250;

/**
 * A profile's color: the palette plus a custom color. A color applies the moment it is picked (a
 * custom one once the picker settles), and is saved without a button.
 */
export function ProfileColorPanel() {
  const profile = useDialogProfile();
  const [picked, setPicked] = useState<WindowColor | null>(null);
  const [failed, setFailed] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<WindowColor | undefined>(undefined);
  const id = useRef(profile.id);
  id.current = profile.id;

  const flush = () => {
    window.clearTimeout(timer.current);
    const color = pending.current;
    pending.current = undefined;
    if (!color) return;
    setFailed(false);
    setProfileColor(id.current, color).catch(() => setFailed(true));
  };
  const choose = (color: WindowColor, immediate: boolean) => {
    setPicked(color);
    // This window takes on its own profile's color right away.
    if (id.current === currentProfile().id) {
      useProfileWindowStore.setState((state) => ({ profile: { ...state.profile, color } }));
    }
    pending.current = color;
    window.clearTimeout(timer.current);
    if (immediate) flush();
    else timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
  };
  // Closing the panel saves a color still waiting on the custom picker.
  useEffect(() => flush, []);

  const chosen = picked ?? profile.color;
  const custom = chosen?.startsWith("#") ?? false;
  return (
    <div>
      <div role="radiogroup" aria-label="Profile color" className="flex justify-between">
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
      <ErrorNotification
        message={failed ? "The color wasn't saved. Try again." : ""}
        onDismiss={() => setFailed(false)}
      />
    </div>
  );
}
