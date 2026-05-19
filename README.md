# misty-docs

Shared docs UI and content for Misty.

## Add a docs page

1. Add a new section object to `src/guide-data.ts`.
2. Add the section id to the matching category in `src/index.tsx`, or add a new category there.
3. Link to it at `/docs/<section-id>`.

The website consumes this package as `@misty/docs`, so docs content and layout live here instead of in `misty-website`.
