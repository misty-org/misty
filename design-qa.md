# Design QA: Misty public-site redesign

## Visual truth and captured states

- Source visual truth: `/var/folders/hd/3cy894z92v70m7crvhv8rwmr0000gn/T/codex-clipboard-2bacf040-2486-46fd-b005-56b304c35442.png`
- Archived source: `audit/2026-07-21-redesign/download-reference.png`
- Implementation capture: `audit/2026-07-21-redesign/download-dark-1115x720.jpg`
- Combined comparison: `audit/2026-07-21-redesign/download-comparison.png`
- Source dimensions: 1115 × 321 px.
- Browser state: 1115 × 720 CSS-pixel viewport, DPR 1, dark theme, signed out, current release expanded.
- Captured implementation dimensions: 1109 × 716 px after the browser's viewport chrome and scrollbar reservation. The comparison scales the implementation to the 1115 px reference width; no density normalization was needed.

## Required surfaces

- Typography: Inter Variable is used for headings, body, labels, controls, and metadata.
- Theme: shadcn `radix-vega` geometry and Zinc semantic tokens were reconciled with the Misty desktop app.
- Components: rounded-xl cards, rounded-md controls, subtle rings, quiet shadows, and tonal Zinc surfaces replace the earlier straight-edged direction.
- Assets: the Download page uses platform marks from the existing icon library. No raster source asset was approximated with CSS, text, or handcrafted SVG.
- Copy: marketing copy is centralized and intentionally uses varied lorem ipsum; product names, routes, release data, plan details, functional labels, and form feedback remain factual.

## Full-view comparison

The Download page preserves the reference's centered title, compact Releases heading, current-version disclosure, horizontal desktop build layout, platform/title/badge row, architecture metadata, and full-width primary buttons. The implementation's card rhythm, corner radius, border contrast, type weight, and dark tonal hierarchy align with both the source and Misty's desktop preset. At mobile width the build cards stack without horizontal overflow.

Intentional differences from the isolated source image:

- The public site retains its shared 64 px navigation shell.
- Only the two real published builds, Windows and macOS, are shown; no Linux build or package type was fabricated.
- Existing ZIP package information, release notes, and beta/support paths remain available below the primary build row.
- Card surfaces are slightly more pronounced to match the Misty desktop application's Vega/Zinc treatment in both themes.

## Focused-region comparison

The release cards remain readable at 1:1 scale in `download-comparison.png`, so a separate crop was unnecessary. The first pass exposed excessive vertical space, stacked platform badges, and the wrong platform order. The final pass uses compact card padding, keeps each title and package badge on one line, puts Windows first, and moves secondary release information beneath the main download row. No actionable P0, P1, or P2 visual differences remain.

## Interaction and responsive QA

- The release disclosure collapses both build cards and restores them correctly.
- Navigation, Resources menu, theme persistence, pricing interval, auth forms, and public CTAs were exercised by the browser suite.
- Browser console errors on the reviewed Download state: none.
- Desktop and mobile public routes passed automated accessibility checks in light and dark themes.
- Homepage and Download were visually reviewed at desktop and 390 px mobile widths in both theme contexts; no horizontal overflow was found.
- Reduced-motion behavior remains static and the product showcase does not require animation to expose content.

## Verification

- TypeScript typecheck: passed.
- ESLint: passed.
- Vitest: 4 passed.
- Playwright: 77 passed, 1 intentionally skipped.
- Production build: passed. Vite reports the existing advisory that the main JavaScript chunk is larger than 500 kB.
- `git diff --check`: passed.

final result: passed
