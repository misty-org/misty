import { Check } from "lucide-react";
import { cn, Input, Pressable } from "@/shared/ui";
import { accentPresets, validAccentColor } from "../store/accentColor";

/** Swatches for the accent: none (monochrome), the Spaces pastels, or any color. */
export function AccentColorControl(props: {
  value: string;
  disabled: boolean;
  onChange(value: string): void;
}) {
  const value = validAccentColor(props.value) ? props.value : "";
  const custom = value !== "" && !accentPresets.some((preset) => preset.value === value);
  const swatch = (color: string, label: string) => {
    const selected = value === color;
    return (
      <Pressable
        key={label}
        aria-label={label}
        aria-pressed={selected}
        title={label}
        disabled={props.disabled}
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-full border border-charcoal-border",
          selected && "ring-2 ring-cream-muted ring-offset-1 ring-offset-charcoal-bg",
        )}
        style={color ? { backgroundColor: color } : undefined}
        onClick={() => props.onChange(color)}
      >
        {selected ? (
          <Check className={cn("size-3.5", color ? "text-avatar-ink" : "text-cream")} />
        ) : null}
      </Pressable>
    );
  };
  return (
    <div
      className="flex flex-wrap items-center justify-end gap-1.5"
      role="group"
      aria-label="Accent color"
    >
      {swatch("", "No accent")}
      {accentPresets.map((preset) => swatch(preset.value, preset.label))}
      <label
        title="Custom color"
        className={cn(
          "relative grid size-6 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-full border border-charcoal-border",
          "bg-[conic-gradient(#eab7ab,#f0d58c,#a8d1b3,#a0c4d4,#d3b3c9,#eab7ab)]",
          custom && "ring-2 ring-cream-muted ring-offset-1 ring-offset-charcoal-bg",
        )}
      >
        <Input
          type="color"
          aria-label="Custom color"
          className="absolute inset-0 h-full cursor-pointer opacity-0"
          disabled={props.disabled}
          value={value || "#a0c4d4"}
          onChange={(event) => props.onChange(event.target.value.toLowerCase())}
        />
        {custom ? <Check className="size-3.5 text-avatar-ink" /> : null}
      </label>
    </div>
  );
}
