# Spaces and Scheduled

This scoped product record covers Misty's Spaces overview, Journal collections, and Scheduled workspace. It does not redefine the rest of Misty.

## Purpose and audience

Misty users move between predefined Chat, Planner, Journal, and Library tools, revisit recent content, and manage recurring tasks in a quiet personal workspace.

## Approved direction

On September 30, 2026, the user approved the Codex-inspired screenshot concepts in `mockups/` and explicitly requested production implementation. Preserve their panel alignment, sidebar hierarchy, collection rows, and restrained copy while using Misty's existing shared components and styling exclusively. Buttons, popovers, panels, tables, menus, and dialogs use the shared library and incumbent monochrome theme.

The Space rail lists the current Space's tools and recent content. Its Trash entry opens Library’s existing Recently Deleted recovery view; notes and drawings still use permanent deletion. It must not list other Spaces: switching Spaces belongs to the main navigation. Predefined tool shortcuts replace templates. No templates, promotional sections, unnecessary explanation, colored statuses, or new visual theme.

## Product behavior

The overview shows authorized recent content from existing services. Each row opens its corresponding tool. Permission restrictions apply equally to navigation, shortcuts, and data requests. Journal retains creation, editing, pinning, deletion, and collaboration, with distinct Pins, Notes, and Drawings destinations and no duplicate Recent entry. Scheduled retains its assigned-agent conversations, schedule editing, run controls, and unsent-draft protection; the welcome suggestions prefill the existing editor for user review. Scheduled loads agents directly, resolves a default when agents arrive after the editor opens, and offers retry on loading failure. Status filtering uses a dropdown.

## Scope and evidence

Production source is under `src/features/spaces`, `src/features/journal`, and `src/features/scheduled`, with reusable composition in `src/shared/ui/patterns/CollectionWorkspace.tsx`. Current comparison evidence is `.impeccable/review/spaces-parity/comparison.html`, with source-labelled supplied Codex screenshots, production-component fixtures, and live Misty captures. Computer-use safety blocked `com.openai.codex`; no live Codex comparison was completed.

Live Misty checks covered New Note, New Task, Upload, Members, Usage, the Scheduled status filter, and a starter editor with an agent loaded and Create enabled. No real schedule was saved and no file was uploaded during QA. Mutation coverage comes from component tests and mocked APIs, not live-account execution. The review disposition is SHIP for screenshot fidelity and inspected code only. Final checks passed for that implementation checkpoint: 68 tests across 15 files, lint, formatting, typecheck, and the desktop production build.
