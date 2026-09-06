# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

Misty serves students, creators, communities, clubs, friends, everyday users, freelancers, and small or temporary teams. People may begin alone, invite others later, or work alongside AI collaborators from the start. They want to make progress on a goal without first choosing, configuring, and continually switching among a collection of disconnected apps.

## Product Purpose

Misty is a complete workspace for anything a person or group wants to accomplish. It brings the browser, notes, files, planning tools, people, and AI collaborators into one collaborative environment organized around the user's goal.

Success means someone can enter Misty, gather the context and tools their goal requires, begin working immediately alone or together, and keep moving between planning, communication, research, and execution without losing their place.

Spaces are collaborative contexts where humans and agents cooperate through shared tools such as chat, planner, agenda, roadmaps, drawings, tasks, notes, and a curated Library. Browser, terminal, code, and Files are personal execution tools by default: they can sit beside a Space, but their contents are shared only through an explicit action.

## Positioning

Misty holds a goal together across people, AI collaborators, shared context, and personal tools. Its differentiating mechanism is one workspace model with platform-appropriate shells: a split-capable desktop workspace and a single-surface mobile projection that preserve the same collaborative context and permission boundaries.

## Operating Context

People use Misty for schoolwork, creative projects, community or club coordination, planning with friends, client work, and everyday personal goals. A desktop session may compare several resizable panes. On iPhone and iPad, people move through the same Space and tabs one surface at a time, with Code, Terminal, and Transfers opened on a paired online desktop when needed.

Users need a fast global launcher to find or open the right tool without reorganizing the left navigation. The Browser supports normal signed-in browsing and bounded delegation to an agent in the same session. Files combines local files with supported connected storage. Space Libraries contain intentionally shared project resources rather than acting as raw file browsers.

## Capabilities and Constraints

- Misty is a React application rendered in a Tauri shell with a Rust core. Desktop and mobile share feature state and design tokens but use dedicated platform shells; the browser build is a server-backed companion that gates local-device capabilities.
- Desktop supports simultaneous resizable panes and virtual windows. Native mobile shows one projected workspace tab at a time and never rewrites the desktop layout tree.
- The universal iOS app supports iPhone and iPad on iOS 15+. iPad uses a persistent sidebar at wide multitasking widths and the compact bottom navigation at narrower widths.
- Downloadable extensions, extension apps, and the Store are unavailable on native mobile. Their routes return to the active Space Home without loading extension APIs.
- Browser, terminal, code, and Files are private by default. Sharing their output or context into a Space must be explicit.
- Agents act only through granted capabilities and current user or Space permissions. Destructive, external, and sensitive actions require an inline approval associated with the triggering run.
- Browser sessions may contain sensitive cookies, credentials, and personal data. Agent access must be scoped, visible, revocable, and auditable; authentication state must never be silently copied into a shared Space.
- A quick-open launcher should switch to an existing surface or open a new one without requiring left-navigation changes.
- iPhone is supported. Android phone packaging and Play Store hardening are not part of the Apple-first mobile release.

## Brand Commitments

The product is named Misty. Its voice is calm, concise, direct, and truthful about permissions, storage, sharing, agent actions, failures, and recovery. Labels favor familiar language over slogans. Future work must not claim an integration or capability that is only a mock or route stub.

The supplied Inbox, Planner, and Files screenshots are binding visual references for the product UI. They establish a restrained charcoal workspace, compact desktop-tool density, clear structural dividers, muted secondary text, restrained rounding, and rare functional color.

## Evidence on Hand

- Product and beta direction: `../BUSINESS.md`
- Existing desktop shell and navigation: `src/application/layouts/DesktopLayout/`
- Existing split-pane and tab primitives: `src/features/workspace/`
- Existing shared UI primitives: `src/shared/ui/`
- Existing design tokens and global behavior: `src/styles/styles.css`
- Representative product surfaces: `src/features/inbox/`, `src/features/spaces/planner/`, and `src/features/files/`
- User-supplied visual references: the Inbox, Planner, and Files screenshots supplied with the Impeccable setup request on August 26, 2026.

No user research, testimonials, or measured evidence for the unified workspace model is currently recorded; future work must not fabricate it.

## Product Principles

1. Let a person begin with a goal, not a stack of apps to configure.
2. Keep shared context and private execution separate by default and connect them explicitly.
3. Let users open the tool they need without abandoning the work already in view.
4. Make agent authority visible, revocable, and understandable.
5. Prefer reliability, permission isolation, and recovery over an ever-growing surface count.

## Accessibility & Inclusion

Desktop workspace switching and pane management must be fully keyboard operable and expose clear focus state and pane identity. Mobile must provide at least 44×44px touch targets, 16px inputs, safe-area handling, rotation support, VoiceOver order and labels, large-text behavior, reduced motion, and no hover-only action. Text and essential controls must retain usable contrast across the dark tonal hierarchy.
