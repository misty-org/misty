# Product

<!-- impeccable:product-schema 1 -->

## Platform
s
web

## Users

Misty serves small teams, temporary cross-functional groups, friends, students, community projects, freelancers and clients, creators, and early-stage teams. A Space may begin with one person, but its purpose is cooperation between humans, teammates, and agents.

## Product Purpose

Misty's long-term goal is to become an operating system for human and agent work. It should let people move fluidly between shared project contexts and personal execution tools without first assembling or agreeing on a full project-management stack.

Spaces are collaborative contexts where humans and agents cooperate through shared tools such as chat, planner, calendar, drawings, tasks, notes, and a curated Library. Browser, terminal, IDE, and Files are primarily personal execution tools: they may be opened beside a Space, but they are not collaborative by default.

Success means a person can start or join a Space, bring in relevant context, work with other people and agents, and execute the work in adjacent personal tools without losing their place.

## Positioning

Misty holds a project together across people, agents, shared contexts, and personal tools. Its differentiating mechanism is a unified, split-capable workspace where collaborative Spaces and private execution surfaces can coexist while retaining explicit context and permission boundaries.

## Operating Context

People use Misty across desktop and tablet-class devices. A typical workspace may contain a Space alongside a browser, terminal, IDE, or file explorer. Users need a fast global launcher to open or switch among those surfaces and need multiple simultaneous, resizable panes for comparison and execution.

The Browser should support normal signed-in browsing and allow a user to delegate bounded browser actions to an agent in the same session. The Files environment combines local files and supported connected storage. Space Libraries contain intentionally shared project resources rather than acting as raw file browsers.

## Capabilities and Constraints

- Misty is a React application in a Tauri shell with a Rust core. It targets desktop, iPad, and Android tablets; the browser build is a server-backed companion and gates local-device capabilities.
- The workspace must support multiple simultaneous panes, not only a single right-side utility.
- Browser, terminal, IDE, and Files are private by default. Sharing their outputs or context into a Space must be explicit.
- Agents may act only through granted capabilities and current user/Space permissions. Destructive, external, and sensitive actions require an inline approval associated with the triggering run.
- Browser sessions may contain sensitive cookies, credentials, and personal data. Agent access must be scoped, visible, revocable, and auditable; authentication state must never be silently copied into a shared Space.
- A quick-open launcher should switch to an existing surface or open a new surface without requiring left-navigation changes.
- Phone-sized iOS and Android devices are not supported.

## Brand Commitments

The product is named Misty. Its voice should be direct and truthful about permissions, storage, sharing, agent actions, failures, and recovery. It should not claim an integration or capability that is only a mock or route stub.

## Evidence on Hand

- Product and beta direction: `BUSINESS.md`
- Existing desktop shell and navigation: `src/application/layouts/DesktopLayout/`
- Existing split-pane and tab primitives: `src/features/workspace/`
- Existing Files workspace: `src/features/files/explorer/`
- Existing Search, Ask, and Action launcher: `src/features/global-search/`
- The supplied reference screenshot demonstrates a compact quick-open menu for Browser, Files, and Side chat.

No user research, testimonials, or measured evidence for the proposed global workspace model is currently recorded; future work must not fabricate it.

## Product Principles

1. Shared context and private execution are separate by default and connected explicitly.
2. A user should be able to open the tool they need without abandoning the work already in view.
3. Agents act within visible, revocable grants and leave an understandable audit trail.
4. Misty should complement established tools while making the project context coherent.
5. Reliability, permission isolation, and recovery matter more than the number of surfaces offered.

## Accessibility & Inclusion

Workspace switching and pane management must be fully keyboard operable, expose clear focus state and pane identity, preserve readable minimum sizes, and respect reduced-motion preferences. Desktop and tablet interaction must not rely on hover alone.
