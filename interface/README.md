# Extension interface

This directory is the public presentation boundary for Misty's extension
catalog. The desktop Store and `misty-website` synchronize these files during
development and builds.

- `catalog.ts` owns the product-neutral TypeScript contract and catalog helpers.
- `react.tsx` owns the reusable extension artwork and verification primitives.
- `styles.css` owns their theme-neutral geometry and states through CSS custom
  properties.

Product-specific layout remains in its product. Installation state and actions
belong to the desktop Store; routing, SEO, and download calls to action belong
to the website.
