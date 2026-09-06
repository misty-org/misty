# Discover interface

This directory owns Misty's public Discover presentation. Desktop Discover and
`misty-website` synchronize these files during development and builds so both
products render the same storefront.

- `catalog.ts` owns the product-neutral TypeScript contract and catalog helpers.
- `react.tsx` owns the reusable extension artwork and verification primitives.
- `styles.css` owns their theme-neutral geometry and states through CSS custom
  properties.
- `store.tsx` owns the Discover shell, navigation, search, featured composition,
  catalog views, and pagination.
- `store.css` owns the Store layout, responsive behavior, and visual tokens.

Product-specific behavior remains in its product. Installation state and native
actions belong to desktop Discover; routing, SEO, and download calls to action
belong to the website.
