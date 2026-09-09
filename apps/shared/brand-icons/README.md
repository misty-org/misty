# Integration brand artwork

`../brandIcons.ts` is the single asset registry for app packages and the host. `../BrandIcon.tsx` renders these SVG files with their original fills and gradients. X uses the same SVG as a silhouette painted black or white according to its surrounding color scheme. ProviderBrandIcon, WebsiteBrandIcon, navigation, workspace tabs, Discover, storage connections, automation integrations, and model pickers reuse it.

Assets are bundled locally with `?inline`, so downloaded app packages and offline views need no third-party logo requests. These are vector paths, not PNG files inside SVG wrappers. `sources.json` records each asset source and any adaptation. Google and Microsoft product artwork comes from their product asset CDNs; remaining artwork comes from the listed brand SVG collections. Trademarks remain the property of their respective owners.

Inherently monochrome marks have a white variant for dark surfaces through an internal SVG color-scheme query. Colored brands retain their original palette in active and inactive states. Misty's own tool icons remain in the host's monochrome app-icon registry.

To update a logo, replace its SVG here, update `sources.json`, and run the shared brand icon and host app icon consistency tests. Add aliases in `brandIcons.ts` rather than duplicate artwork. Keep adaptive monochrome treatment in the shared renderer; never introduce a per-surface recolor, grayscale filter, or hand-drawn brand approximation.
