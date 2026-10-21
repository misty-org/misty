/**
 * An opaque computed color as `#rrggbb`, from a color function's name and arguments. A Space's
 * wash is a `color-mix(in srgb, …)`, which Chromium computes as `color(srgb r g b)` with
 * channels from 0 to 1, not `rgb()`.
 */
export function opaqueColorHex(func: string, args: string): string | undefined {
  const parts = args.split(/[\s,/]+/).filter(Boolean);
  if (func === "color" && parts.shift() !== "srgb") return undefined;
  const unit = func === "color" ? 255 : 1;
  const [red, green, blue, alpha = "1"] = parts;
  const fraction = (value: string) =>
    value.endsWith("%") ? parseFloat(value) / 100 : Number(value);
  if (!(fraction(alpha) >= 1)) return undefined;
  const hex = [red, green, blue].map((channel) => {
    if (channel === undefined) return undefined;
    const value = channel.endsWith("%") ? fraction(channel) * 255 : Number(channel) * unit;
    if (!Number.isFinite(value)) return undefined;
    return Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, "0");
  });
  return hex.every(Boolean) ? `#${hex.join("")}` : undefined;
}
