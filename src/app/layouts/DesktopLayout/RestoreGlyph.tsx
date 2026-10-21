import type { ReactNode } from "react";

/** The caption glyphs share the 16px box and 1.5 stroke of the icons beside them. */
function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ width: 16, height: 16 }}
    >
      {children}
    </svg>
  );
}

export const MinimizeGlyph = () => (
  <Glyph>
    <path d="M3.5 8h9" />
  </Glyph>
);

export const MaximizeGlyph = () => (
  <Glyph>
    <rect x="3.5" y="3.5" width="9" height="9" rx="2" />
  </Glyph>
);

export const RestoreGlyph = () => (
  <Glyph>
    <path d="M6 4V4.5A1.5 1.5 0 0 1 7.5 3H11a2 2 0 0 1 2 2v3.5A1.5 1.5 0 0 1 11.5 10H11" />
    <rect x="3" y="6" width="7" height="7" rx="1.75" />
  </Glyph>
);

export const CloseGlyph = () => (
  <Glyph>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Glyph>
);
