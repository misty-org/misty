# Brand artwork

`../brandIcons.ts` is the single asset registry, and `../BrandIcon.tsx` renders these SVG files with their original fills and gradients. Single-color marks such as X, Linear, GitHub and Composio render as silhouettes painted black or white to match the surface around them; an `<img>` would follow the OS appearance instead of the app surface. `BrandIcon` draws connected apps (Integrations rows and tiles, the app chips under the Agents composer), coding tools in the composer's Code menu (through `CodingToolIcon`) and source browsers in the browser import flow.

Assets are bundled locally with `?inline`, so no view makes third-party logo requests. These are vector paths, not PNG files inside SVG wrappers. `sources.json` records each asset's source and any adaptation. Google and Microsoft product artwork comes from their product asset CDNs; the rest comes from the listed brand SVG collections. Trademarks remain the property of their respective owners.

Inherently monochrome marks have a white variant for dark surfaces through an internal SVG color-scheme query. Colored brands keep their original palette in every state. Misty's own tool icons stay in the monochrome app-icon registry (`../appIcons.ts`); apps without artwork fall back to a monochrome Lucide icon.

To update a logo, replace its SVG here and update `sources.json`. Add aliases in `brandIcons.ts` rather than duplicating artwork. Keep the adaptive monochrome treatment in the shared renderer; never recolor a logo per surface, gray it out, or hand-draw a substitute.
