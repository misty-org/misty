import type { CSSProperties, ReactNode } from "react";

type LogoSize = number | string;

/**
 * What a logo slot shows when there is no artwork: the name's first letter, drawn bare in the text
 * colour. A logo is never left blank.
 */
export function LogoInitial({ name, size = 16 }: { name: string; size?: LogoSize }) {
  const letter = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      data-logo-initial={letter}
      style={{ flexShrink: 0 }}
    >
      <text
        x="12"
        y="12"
        dominantBaseline="central"
        textAnchor="middle"
        fontSize="17"
        fontWeight="700"
        fill="currentColor"
      >
        {letter}
      </text>
    </svg>
  );
}

/** The theme on which a logo all but disappears, and so sits on a plate there. */
export type LogoPlateTheme = "dark" | "light";

/**
 * Logos whose official artwork has no variant that reads on one theme, by kind and id. Prefer the
 * brand's own light or dark variant; list a logo here only when none exists.
 * `logoArtwork.contract.test.tsx` checks every logo's contrast on both themes against this list.
 */
export const logoPlates: Record<string, LogoPlateTheme> = {
  "brand:aws": "dark",
  "brand:citrix": "dark",
  "brand:meituan": "light",
  "provider:openrouter-color": "light",
};

const plateStyle: Record<LogoPlateTheme, CSSProperties> = {
  // A light plate on the dark theme only, and a dark plate on the light theme only.
  dark: { backgroundColor: "light-dark(transparent, #f2f2f2)" },
  light: { backgroundColor: "light-dark(#1c1c1c, transparent)" },
};

/**
 * Puts a logo on a small plate on the theme where it would disappear, as a last resort after the
 * brand's own variants. Logos not in `logoPlates` pass through bare.
 */
export function LogoPlate({ logo, children }: { logo: string; children: ReactNode }) {
  const theme = logoPlates[logo];
  if (!theme) return children;
  return (
    <span
      data-logo-plate={theme}
      style={{
        display: "inline-flex",
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        padding: 2,
        borderRadius: 4,
        ...plateStyle[theme],
      }}
    >
      {children}
    </span>
  );
}
