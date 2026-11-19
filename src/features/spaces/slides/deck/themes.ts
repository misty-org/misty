import type { DeckThemeId } from "./types";

/**
 * The six built-in themes as tokens. A slide's colors and type are its content, so they live
 * here and never in Misty's own interface. Every font is SIL OFL, bundled for the app
 * (`themeFonts.ts`) and named as Google Fonts names it, so a PowerPoint or Google Slides export
 * asks for the same family.
 */

export interface ThemeFont {
  /** The family the app's bundled font registers (`@fontsource…`). */
  css: string;
  /** The family an export names, as Google Fonts and Office know it. */
  office: string;
  /** What the CSS stack falls back to while the font loads. */
  fallback: string;
}

export interface ThemeColors {
  background: string;
  text: string;
  soft: string;
  accent: string;
  line: string;
}

export interface DeckTheme {
  id: DeckThemeId;
  name: string;
  heading: ThemeFont;
  body: ThemeFont;
  headingWeight: number;
  colors: ThemeColors;
  /** The five chart series colors, in order. */
  series: [string, string, string, string, string];
  /** The spacing scale in frame pixels: paragraph gap, bullet gap, a visual's corner radius. */
  spacing: { paragraph: number; bullet: number; radius: number };
  /**
   * The Misty theme follows the app's own light or dark look on screen: each color is read
   * from the app's theme variable, with the literal above as its fallback and for exports.
   */
  appVariables?: Partial<Record<keyof ThemeColors, string>>;
}

const fraunces: ThemeFont = {
  css: "Fraunces Variable",
  office: "Fraunces",
  fallback: "Georgia, serif",
};
const inter: ThemeFont = {
  css: "Inter Variable",
  office: "Inter",
  fallback: "system-ui, sans-serif",
};
const spaceGrotesk: ThemeFont = {
  css: "Space Grotesk Variable",
  office: "Space Grotesk",
  fallback: "system-ui, sans-serif",
};
const plex: ThemeFont = {
  css: "IBM Plex Sans",
  office: "IBM Plex Sans",
  fallback: "system-ui, sans-serif",
};

const spacing = { paragraph: 0.45, bullet: 0.5, radius: 18 };

export const deckThemes: Record<DeckThemeId, DeckTheme> = {
  misty: {
    id: "misty",
    name: "Misty",
    heading: inter,
    body: inter,
    headingWeight: 600,
    colors: {
      background: "#191919",
      text: "#f1f1f1",
      soft: "#8c8c8c",
      accent: "#e0e0e0",
      line: "#2b2b2b",
    },
    series: ["#e0e0e0", "#8c8c8c", "#5f8fd6", "#6fb38a", "#d39a5c"],
    spacing,
    appVariables: {
      background: "--misty-theme-card",
      text: "--misty-theme-text-bright",
      soft: "--misty-theme-text-muted",
      accent: "--misty-theme-text",
      line: "--misty-theme-border",
    },
  },
  paper: {
    id: "paper",
    name: "Paper",
    heading: fraunces,
    body: inter,
    headingWeight: 600,
    colors: {
      background: "#f6f1e7",
      text: "#2b2622",
      soft: "#8a7f72",
      accent: "#c0573a",
      line: "#e3dccd",
    },
    series: ["#c0573a", "#2b2622", "#d9a441", "#6f8f72", "#8a7f72"],
    spacing,
  },
  ink: {
    id: "ink",
    name: "Ink",
    heading: spaceGrotesk,
    body: inter,
    headingWeight: 600,
    colors: {
      background: "#15171c",
      text: "#eef0f3",
      soft: "#8b93a1",
      accent: "#7fb4ff",
      line: "#2a2e37",
    },
    series: ["#7fb4ff", "#f2c46d", "#7fd1b9", "#e98aa8", "#b39cf0"],
    spacing,
  },
  plain: {
    id: "plain",
    name: "Plain",
    heading: inter,
    body: inter,
    headingWeight: 700,
    colors: {
      background: "#ffffff",
      text: "#111111",
      soft: "#777777",
      accent: "#111111",
      line: "#e6e6e6",
    },
    series: ["#111111", "#777777", "#b5b5b5", "#3d6fd9", "#d9583d"],
    spacing,
  },
  forest: {
    id: "forest",
    name: "Forest",
    heading: fraunces,
    body: plex,
    headingWeight: 600,
    colors: {
      background: "#1f2b24",
      text: "#eef1e9",
      soft: "#9fae9b",
      accent: "#c8d98f",
      line: "#33443a",
    },
    series: ["#c8d98f", "#e0b872", "#8fc7c0", "#d98f7a", "#a7b3e0"],
    spacing,
  },
  signal: {
    id: "signal",
    name: "Signal",
    heading: spaceGrotesk,
    body: plex,
    headingWeight: 600,
    colors: {
      background: "#fbfaf7",
      text: "#14161a",
      soft: "#6f7480",
      accent: "#e5484d",
      line: "#e7e5df",
    },
    series: ["#e5484d", "#14161a", "#f5a524", "#3e8ed0", "#6f7480"],
    spacing,
  },
};

export const deckThemeList: DeckTheme[] = [
  deckThemes.misty,
  deckThemes.paper,
  deckThemes.ink,
  deckThemes.plain,
  deckThemes.forest,
  deckThemes.signal,
];

export function deckTheme(id: DeckThemeId | undefined): DeckTheme {
  return (id && deckThemes[id]) || deckThemes.misty;
}

export function fontStack(font: ThemeFont): string {
  return `"${font.css}", ${font.fallback}`;
}

/** A theme color for the screen: the Misty theme reads the app's variable, others are literal. */
export function screenColor(theme: DeckTheme, key: keyof ThemeColors): string {
  const variable = theme.appVariables?.[key];
  return variable ? `var(${variable}, ${theme.colors[key]})` : theme.colors[key];
}

/**
 * A theme's colors as hex, for an export: the Misty theme takes the app's current look when it
 * can be read as hex, else its literal colors.
 */
export function exportColors(theme: DeckTheme): ThemeColors {
  const colors = { ...theme.colors };
  if (!theme.appVariables || typeof document === "undefined") return colors;
  const style = getComputedStyle(document.documentElement);
  for (const key of Object.keys(theme.appVariables) as (keyof ThemeColors)[]) {
    const value = style.getPropertyValue(theme.appVariables[key]!).trim();
    if (/^#[0-9a-f]{6}$/i.test(value)) colors[key] = value;
  }
  return colors;
}

/** The families a theme draws with and the weights it uses, for loading before measuring. */
export function themeFontFaces(theme: DeckTheme): string[] {
  const faces = new Set<string>();
  for (const weight of [400, 500, 600, 700]) {
    faces.add(`${weight} 32px "${theme.body.css}"`);
    faces.add(`${weight} 32px "${theme.heading.css}"`);
  }
  return [...faces];
}
