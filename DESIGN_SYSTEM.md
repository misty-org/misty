# Misty web design system

Misty uses source-owned [shadcn/ui](https://ui.shadcn.com) components with Radix primitives, the Vega visual style, Zinc base and chart colors, and Tailwind CSS v4. The canonical configuration is shadcn preset `bKbuJVbVq`.

## Rules

- Use semantic utilities such as `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `text-destructive`, and `ring-ring`.
- Do not introduce raw neutral hex values or `zinc-*`, `gray-*`, `white`, or `black` utilities for normal application surfaces. Image overlays and brand artwork are the exception.
- Start with a component from `src/components/ui` for controls and repeatable surfaces. Compose it with page-specific classes instead of copying its base styles.
- Use `cn` from `@/lib/utils` for conditional class composition.
- Use Lucide for interface icons. Keep `react-icons` only for brand or provider marks that Lucide does not supply.
- Preserve page-layout decisions in page components. The shared system owns tokens, controls, states, focus treatment, radii, and surfaces—not a universal container.

## Themes

Light and dark values live in `src/index.css` under `:root` and `.dark`. `ThemeProvider` persists the visitor's choice under `misty-ui-theme`, and `ModeToggle` is the only public theme control.

Inter is used for both body/interface copy and headings. Interface icons use Lucide, the base radius is medium, and menus use the preset's subtle, translucent treatment.

Legacy utilities such as `bg-bg` and `text-text` are temporarily mapped to semantic variables while remaining page code is migrated. New code must use the semantic names.

## Components

Add or refresh official components through the pinned project configuration:

```sh
npx shadcn@latest add <component>
```

The `components.json` file fixes the system to Radix + Vega + Zinc and places source in `src/components/ui`. Review generated diffs before overwriting a component that has local changes.

## Verification

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run test:e2e`
- `VITE_API_BASE=/api npm run build`

Public route smoke tests cover both themes and desktop/mobile navigation. Keep new interactive components keyboard accessible and add an automated accessibility assertion when introducing a new interaction pattern.
