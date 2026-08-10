# Misty website visual audit

Date: 2026-07-21

## Scope

Reviewed the rendered homepage, homepage feature narrative, Features, Pricing, Download, Blog, and the mobile homepage in the current local worktree. The audit focuses on why the site feels generic, AI-generated, and unfinished rather than on implementation quality alone.

## Overall verdict

The site is structurally competent and technically accessible, but it lacks a strong authored point of view. Nearly every route uses the same black background, Inter type, muted gray copy, pill labels, charcoal cards, centered headings, and white calls to action. The result looks like a polished component library demo rather than a distinct product brand.

The strongest damage comes from four things:

1. A generic visual vocabulary is repeated without contrast or surprise.
2. The product story is too broad and provisional: shared workspaces, local files, integrations, AI, pricing, roadmap, and beta status all compete at once.
3. Product imagery mixes different eras and levels of fidelity, including old file-first screens and code-built mock interfaces.
4. The site is over-complete in structure but under-specific in proof. It has every expected SaaS section, but few concrete outcomes, customer stories, real workflows, or unmistakably Misty details.

## Captured steps

1. **Homepage hero — weak.** The centered headline, pill badge, paired CTAs, radial glow, and floating screenshot carousel are familiar AI/SaaS defaults. The carousel is visually dark and shows inconsistent product surfaces.
2. **Features — weak.** Clear hierarchy, but the oversized empty field and alternating card template make the page feel generated from a standard feature-grid recipe.
3. **Pricing — weak.** The three equal cards, “Recommended” pill, billing toggle, checkmark lists, and full-width buttons are the most stereotypical SaaS section on the site. Showing exact future prices while checkout is closed adds a placeholder feeling.
4. **Download — fair.** This is the clearest task-focused page, but it inherits the same centered hero and charcoal-card system, so it still has little product personality.
5. **Blog — poor.** One archived post sits in a large generic card, and the copy explicitly explains a previous product direction. That makes the current positioning feel unresolved.
6. **Mobile homepage — fair.** It reflows cleanly, but the hero consumes almost an entire screen before meaningful product evidence appears. The product screenshot is too small and dark to communicate value.
7. **Homepage feature rows — weak.** Alternating product mockups and copy create a 7,000+ pixel page with 8 sections, 11 level-two headings, and 11 cards. The pattern is orderly but monotonous and reads like “include every landing-page section.”

## Why it feels AI-generated

### 1. The design system starts from generic defaults

The site explicitly uses the shadcn Vega style, Zinc base colors, Inter for both body and headings, medium radii, Lucide icons, and semantic card components. Those are good implementation defaults, but they are not a brand. The blue and yellow Misty accent variables exist but are unused on the reviewed marketing routes, leaving the mascot as the only memorable color.

### 2. The page grammar is repeated everywhere

The recurring formula is: tiny uppercase eyebrow, large headline with tight tracking, muted paragraph, pill CTA, rounded card, thin border, and a soft radial glow. Repetition creates consistency, but here it removes hierarchy between routes and between important and secondary sections.

### 3. Product proof is simulated more often than demonstrated

Many product visuals are code-built preview cards with invented names, tasks, dates, files, and messages. They are internally consistent, but visibly staged. The carousel also combines screenshots with very different dimensions and product eras, including file-browser screens and the newer Space concept. This makes Misty look like a prototype whose positioning is still being assembled.

### 4. The copy is broad, safe, and interchangeable

Phrases such as “everything the project needs,” “keep moving,” “bring the tools you already use,” and “one shared place” communicate category benefits but not a sharp reason to choose Misty. They could describe Notion, Slack, ClickUp, Basecamp, or dozens of AI workspace products.

### 5. The site exposes unresolved product state

Visitors see “invite-only beta,” public downloads, shared services that require approval, “future pricing,” a closed checkout, pilot integrations, coming integrations, conditional Mika availability, a roadmap, and an archived file-first launch story. Each statement may be honest, but together they say “unfinished product” more loudly than “focused beta.”

### 6. The information architecture is too exhaustive

The homepage tries to carry the hero, four pillars, five feature deep-dives, a three-step workflow, changelog, roadmap, blog, and final CTA. It behaves like a generated checklist of landing-page sections instead of a deliberate persuasion sequence.

## What is working

- The implementation is clean enough to support a redesign without starting over.
- Navigation, heading structure, responsive reflow, reduced-motion behavior, and public-route accessibility checks are in good shape.
- The mascot is distinctive and gives the brand a potentially ownable visual direction.
- Download is relatively direct and could be the model for clearer task-focused pages.

## Accessibility evidence and limits

The automated WCAG A/AA checks passed on all 50 desktop/mobile, light/dark public-route cases. The DOM also exposes a skip link, semantic landmarks, descriptive image text, and reduced-motion handling. This does not prove full accessibility: keyboard behavior, zoom/reflow beyond the tested breakpoints, screen-reader announcements, and the practical usability of the carousel still need hands-on testing.

## Recommended reset

1. Decide on one precise promise and one primary user scenario. The current “whole project” promise is too broad.
2. Build an authored visual language from the mascot and product: use the existing blue/yellow accents, a more characteristic display face, custom diagrams/illustrations, and fewer generic cards.
3. Replace the rotating screenshot pile with one legible, annotated workflow showing a specific before/after outcome.
4. Cut the homepage to four beats: promise, proof, how it works, beta CTA. Move roadmap, changelog, blog, and exhaustive feature material to their own routes.
5. Resolve the beta story into one sentence and remove future pricing from primary navigation until it helps a real decision.
6. Replace staged generic content with evidence: a real project example, a clear target audience, a founder point of view, and concrete product constraints.

## Evidence

- `01-home-desktop-top.jpg`
- `02-features-desktop.jpg`
- `03-pricing-desktop.jpg`
- `04-download-desktop.jpg`
- `05-blog-desktop.jpg`
- `06-home-mobile.jpg`
- `07-home-feature-rows.jpg`

