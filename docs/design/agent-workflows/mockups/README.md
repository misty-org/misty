# Agent workflow mockups

Revision three is the current interactive proposal. The user rejected revisions one and two because the pages did not look like Polar's layout. This revision follows native Polar page geometry with Misty's shared controls, optional task context, and floating execution. These isolated React/Vite mockups do not replace production routes or establish production approval. See the [design record](../DESIGN.md).

Start with the [comparison viewer](http://127.0.0.1:5207/comparison.html): select a page and move the divider between native Polar and Misty captures at the same 1920 × 1050 viewport. The [viewer capture](screenshots/revision-three/comparison.jpg) provides a static entry point.

From the repository root, with dependencies installed:

```sh
node node_modules/vite/bin/vite.js --config docs/design/agent-workflows/mockups/vite.config.mjs
```

The port is fixed at 5207; stop an existing instance before starting another. Build with:

```sh
node node_modules/vite/bin/vite.js build --config docs/design/agent-workflows/mockups/vite.config.mjs
```

Build output goes to this folder's `dist/`. The harness imports the repository's shared stylesheet and controls, so it runs within this repository.

## Current pages and evidence

| Page | Interactive view | Native Polar | Misty revision three |
| --- | --- | --- | --- |
| New task | [Open](http://127.0.0.1:5207/?screen=new) | [Reference](references/polar-pages/polar-new.png) | [Capture](screenshots/revision-three/misty-new.jpg) |
| Workflows | [Open](http://127.0.0.1:5207/?screen=workflows) | [Reference](references/polar-pages/polar-workflows.png) | [Capture](screenshots/revision-three/misty-workflows.jpg) |
| Workflow editor | Open a workflow or create one from template details | [Reference](references/polar-pages/polar-workflow-editor.png) | [Capture](screenshots/revision-three/misty-workflow-editor.jpg) |
| Templates | [Open](http://127.0.0.1:5207/?screen=templates) | [Reference](references/polar-pages/polar-templates.png) | [Capture](screenshots/revision-three/misty-templates.jpg) |
| Template detail | Select a template | [Reference](references/polar-pages/polar-template-detail.png) | [Capture](screenshots/revision-three/misty-template-detail.jpg) |
| Customize: Connectors | [Open](http://127.0.0.1:5207/?screen=customize) | [Reference](references/polar-pages/polar-customize.png) | [Capture](screenshots/revision-three/misty-customize.jpg) |
| Customize: Instructions | Open Customize, then Instructions | [Reference](references/polar-pages/polar-instructions.png) | [Capture](screenshots/revision-three/misty-instructions.jpg) |
| Customize: Skills | Open Customize, then Skills | [Reference](references/polar-pages/polar-skills.png) · [Skill detail](references/polar-pages/polar-skill-detail.png) | [Capture](screenshots/revision-three/misty-skills.jpg) |

Instructions and Skills use Customize's own secondary navigation; they are not direct `screen` query values. Additional captures show [Templates at the default desktop size](screenshots/revision-three/user-templates.jpg), [floating execution](screenshots/revision-three/user-floating.jpg), and [Templates at 390px](screenshots/revision-three/mobile-templates.jpg).

Try searching and filtering templates, opening details, creating a workflow, and editing schedule fields. Customize exposes connector fixtures, instructions, and skill details. The [agent run scene](http://127.0.0.1:5207/?screen=run) retains the compact dock; expand it to see the floating conversation with its top composer. Pause/Resume, Take over, and Stop demonstrate intervention. The footer also exposes guided questions, background handoff, work in the current window, and completion review.

## Boundaries and validation

All records and browser pages are fixtures; interactions change temporary React state or display preview notices. Separate window is a simulated Misty view, not a spawned OS window. No live browser control, connections, saved workflows, schedules, or account settings updates occur. Reload resets state.

The focused TypeScript check and final Vite build passed; the build reported a large-chunk warning. Browser checks covered template detail → workflow editor, schedule fields, and the comparison range control. The overflow detector ran once and returned no findings (`[]`). Evidence uses native/reference-size 1920 × 1050, default 1304 × 954, and mobile fallback 390 × 844 views. These checks do not establish complete production or mobile coverage.

A fresh revision-three reviewer returned **SHIP**, with all 20 required captures valid and no material fixes. The disposition covers **page-layout fidelity and mockup presentation only**. It is not approval to replace production UI.

## References and provenance

The nine PNGs in [references/polar-pages/](references/polar-pages/) are CUA screenshots of the installed Polar app. The twelve JPEGs in [screenshots/revision-three/](screenshots/revision-three/) capture the local Misty prototype and its comparison viewer. All 21 shipped rasters have origin metadata; the final scan found zero missing records. These images were captured, not generated.

Earlier native execution observations remain in [references/polar/](references/polar/): [question card](references/polar/polar-question-card.png), [active browser](references/polar/polar-active-browser.png), [floating preview](references/polar/polar-floating-preview.png), and [minimized controls](references/polar/polar-minimized-control.png). They support compact tool chips, questions folding answers into chat, collapsed preview, current-tab glow, a cursor action label, and Stop Agent. **A separate Polar OS instance was not verified.**

The cloud is the existing repository asset [cloud-sky-poster.webp](../../../../src/shared/assets/agents/cloud-sky-poster.webp). Current sources are the [direction contract](index.html), [revision-three.tsx](revision-three.tsx), [revision-three.css](revision-three.css), [polar-pages.tsx](polar-pages.tsx), and [comparison.html](comparison.html). The prototype inherits floating-execution styling from [revision-two.css](revision-two.css).

Rejected revision two is retained in [revision-two.tsx](revision-two.tsx), [revision-two.css](revision-two.css), and [its captures](screenshots/revision-two/). Rejected revision one remains in [revision-one.html](revision-one.html), [preview.tsx](preview.tsx), [preview.css](preview.css), and the older top-level `screenshots/` captures. Their former review dispositions do not override the user's rejection.
