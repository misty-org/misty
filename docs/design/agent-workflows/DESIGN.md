---
name: Misty agent workflow study — revision three
description: Native Polar page geometry with Misty shared controls and floating agent execution.
---

# Design System: Agent workflow study

## Overview

Revision three is the current **mockup proposal**. The user rejected revisions one and two because the pages did not look like Polar's layout. This revision takes its page geometry from screenshots of the installed Polar app, while retaining Misty's shared controls, monochrome treatment, optional context, and floating execution. These are local study decisions; the existing [Agents product direction](../../../src/features/agents/PRODUCT.md) remains authoritative for production.

The direction contract is [mockups/index.html](mockups/index.html). The implementation is [revision-three.tsx](mockups/revision-three.tsx), [revision-three.css](mockups/revision-three.css), and [polar-pages.tsx](mockups/polar-pages.tsx). Start review in the [same-size comparison viewer](http://127.0.0.1:5207/comparison.html), which pairs native Polar references with rendered Misty pages. Revisions one and two remain historical evidence, not approved alternatives.

## Colors

Use Misty's shared semantic `--misty-theme-*` properties. The harness applies neutral theme overrides for this study. Chrome, navigation, selection, focus, and status stay black, white, and gray; status also uses words and icons. The grayscale edge glow and cursor action label identify active agent control; Pause and Take over remove that treatment.

Existing cloud artwork supplies identity, not status. Content item-type glyphs follow the shared `itemTones.ts` map where applicable; tiles and interaction states stay monochrome. Polar's colored chrome and status dots are reference evidence, not Misty styling instructions. The preview theme switch is a harness control, not an account preference.

## Typography

Inherit Misty's shared font stack and controls. The launch heading is 32px with a 38px line height and regular weight; page headings are 20px, with compact 14px body text and 10–13px metadata. Native references inform hierarchy and density, without establishing a new global Misty type scale.

## Layout

The desktop shell uses a 240px primary sidebar, 36px top strip, and 208px secondary navigation column. Navigation contains New task, Workflows, Templates, and Customize. Spaces and Projects are absent from navigation; context is optional and attached to a task.

| Surface | Revision-three geometry |
| --- | --- |
| New task | Centered 672px launch composer with optional context and work-location choice. |
| Workflows | 960px content column, workflow rows, and an editable workflow dialog with schedule fields. |
| Templates | 960px catalog with search, categories, three-column cards, and template details. |
| Customize: Connectors | 1088px catalog with grouped connector cards. |
| Customize: Instructions | 768px instructions column, reached through Customize's secondary navigation. |
| Customize: Skills | 320px list beside the detail area, reached through Customize's secondary navigation. |

These desktop widths are constrained to available space. Below 1400px catalog density tightens; below 1050px the sidebar and secondary navigation narrow and cards use two columns. Below 760px primary navigation becomes an icon rail and secondary navigation moves above the content. Evidence covers 1920 × 1050 reference comparisons, 1304 × 954 default views, and a 390 × 844 template fallback; this does not establish complete mobile behavior.

Floating execution is retained: guided questions lead to a simulated separate Misty window or work in the current window. A compact dock expands to a floating conversation with its composer at the top, compact tool activity, and intervention controls. Execution does not become a permanent conversation/browser split. The footer is review tooling.

## Elevation & Depth

Fine borders and neutral surfaces organize the shell and catalogs. Dialogs, floating docks, conversation, and completion panels use shadows above the content. The grayscale edge glow communicates active agent control. Reduced-motion preferences disable the glow, spinner, and thinking animations.

## Shapes

Shared controls retain their component language. The canvas has gently rounded corners (12px); the launch composer and floating conversation use softer corners (17px). Cards and dividers reproduce the reference page density without adding a container around every section.

## Components

The harness uses real Misty MessageComposer, Button, IconButton, DropdownMenu, Input, Textarea, OptionSelect, Card, Dialog, and DesktopSettingsSection components, with Lucide icons. Shared dropdown and context-menu selections use checkmarks. Keep production Settings geometry, its single navigation registry, shared row/control patterns, and server-account preference model intact in any later implementation.

Templates open details and can hand off to the workflow editor. Schedule fields, connector actions, instruction edits, and skill details are illustrative React state. The floating dock exposes Pause/Resume, Take over, and Stop; activity uses compact expandable tool chips. All records, browser content, connections, preferences, schedules, and results are fixtures. No live integrations, account persistence, browser automation, or native window control is implemented.

## Do's and Don'ts

- Do compare page geometry against the native references at the same viewport using the comparison viewer.
- Do keep optional task context and floating execution while matching Polar's page structure.
- Do reuse the existing [cloud artwork](../../../src/shared/assets/agents/cloud-sky-poster.webp); no raster assets were generated.
- Do distinguish native captures, local mockup captures, and unverified behavior. A separate Polar OS instance was not verified; separate Misty windows are simulated.
- Don't restore the rejected Spaces sidebar, permanent split, or progress presentation from revision one, or treat revision two as current.
- Don't interpret a mockup verdict as production approval or promote this study into global Misty styling.

The fresh revision-three reviewer disposition is **SHIP for page-layout fidelity and mockup presentation only**, with no material fixes. Evidence, validation limits, and historical files are recorded in the [preview guide](mockups/README.md).
