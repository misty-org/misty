# Misty Product and Business Direction

Last updated: July 25, 2026

## Product promise

> Create a shared project space as easily as starting a group chat.

Misty helps a group start working together without first agreeing on a full project-management stack. A Space brings the people and essential project material into one shared environment: conversations, tasks, notes, a curated Library, and a context-aware agent.

The long-term differentiator is:

> Your tools hold pieces of the work. Misty holds the project together.

Misty is not an enterprise company brain, a generic project-management suite, or a replacement for Files, Notion, Slack, Discord, Jira, or ClickUp. It should complement tools a group already uses and only advertise integrations that work.

## Who Misty serves

The beta is for groups that need to begin collaborating quickly:

- Small teams and temporary cross-functional groups
- Friends, students, and community projects
- Freelancers working with clients
- Creators and collaborators
- Early-stage teams that do not want enterprise setup

A Space may start with one person, but its product purpose is collaboration. The first-run experience should make creating or joining a Space feel lightweight and make inviting another person the natural next step.

## Product model

### Files

Files is the user's private file environment. It combines local files and supported connected storage without pretending every file belongs to a project.

An agent in Files works on the user's private file context. Adding a file to a Space creates an explicit shared copy or reference according to the action shown in the UI; Misty never silently moves or destroys the original.

### Spaces

A Space is a shared project environment with a clear identity and membership boundary. Its beta work surfaces are:

- Chat
- Tasks
- Notes, once they are durably Space-scoped
- Library
- Members
- Settings and working integrations

Members and Settings are management surfaces rather than daily work tabs.

### Library

The Library is a curated set of resources shared with a Space. It is not a second raw file browser.

The intended loop is:

> Files → Add relevant content to a Space → Shared Library → Collaborate

Copy, upload, and reference semantics must always be explicit. Provenance, contributor, permission, progress, failure, and recovery states are part of the product—not implementation details.

### Agents

Agents are a first-class part of the product with their own destination, and they are Space-aware: an agent knows which Space and which surface the member is working in, and what that member is allowed to do there.

- In Files, an agent works from the user's private file context.
- In a Space, an agent uses only the current member's authorized context for that Space.
- Space agent conversations are private to the current account and Space.
- An agent should know what a Space is and what its surfaces do, so it can answer questions about the work as well as about the content.
- Important answers should link to the Space items that supported them.

Space context and histories must be enforced by the server. A client-only filter is not a security boundary. If the connected server cannot create permission-checked Space sessions, the application must show an unavailable state instead of sending Space context through an account-wide session.

Context must be rebuilt as the work changes rather than captured once when a conversation starts, so an agent does not answer from a stale view of the Space.

Agents may read Space content and perform a limited set of writes. Reads are permission-checked at data access. Writes are explicit, described in plain language before they happen, and confirmed by the member; an agent never mutates shared, multi-member state silently.

`@agent` mentions in Chat are a shared Space behavior and run server-side. They are distinct from the private agent conversation, which belongs to one member.

### Integrations

Integrations belong where they provide project value. Working Space integrations should live in Space Settings or the relevant work surface. Working file providers should remain in Files.

Misty should not ship a dead marketplace or claim support based only on a mock, route stub, or planned connector. Discovery can expand after several integrations are reliable enough to justify a dedicated surface.

## Beta scope

The beta succeeds when two people can complete this loop reliably:

1. Sign in.
2. Browse private local or supported cloud files.
3. Create or join a Space.
4. Invite and manage another member.
5. Add selected files to the Space Library with clear copy/reference semantics.
6. Communicate in Chat.
7. Create and use shared Tasks.
8. Create and use durable shared Notes.
9. Understand and manage access.
10. Open a private agent conversation from any Space section.
11. Receive an answer grounded only in authorized Space context.
12. Switch accounts or Spaces without carrying history or context across the boundary.

Space-aware agents are in this beta: reading authorized Space context, knowing what the surfaces do, and a small set of confirmed writes.

Studio, Workflows, Automations, an integration marketplace, and enterprise knowledge aggregation remain outside it. They should not displace work on the collaboration loop.

## Trust principles

- Permission checks happen at data access, not only in the interface.
- Private agent sessions are isolated by account and Space on the server.
- Membership is rechecked when context or history is read.
- Local originals remain intact when content is shared.
- Uploads show destination, progress, cancellation, and failures.
- Connected services are described accurately, including what is stored remotely.
- Empty and unavailable states tell the truth; demo data is never presented as a member's project data.

## Business approach

Misty should earn adoption through fast project starts and successful collaboration, then grow with the number of active Spaces and participating members.

An initial free or low-friction tier should make it easy to create a Space and invite a small group. Paid value can come from limits that track real product cost and utility, such as shared storage, active collaborative Spaces, agent usage, richer history, and reliable premium integrations. Pricing should not punish a group merely for trying collaboration.

Enterprise administration, company-wide search, and broad connector catalogs are not the initial wedge. If larger organizations adopt Misty later, administration should support the core project experience rather than redefine the product around procurement.

## Measures of progress

The most useful beta measures are behavioral and reliability-focused:

- Time from sign-in to first created or joined Space
- Share of new Spaces that invite a second member
- Successful invitation acceptance rate
- Share of active Spaces using Library plus at least one collaboration surface
- Files-to-Library upload success, cancellation, and recovery rates
- Weekly Spaces with two or more active members
- Permission, cross-account, and cross-Space isolation incidents (target: zero)
- Space agent answers with valid, openable sources
- Retention of groups that complete the full collaboration loop

Raw message volume or the number of available features is less important than whether a group can start, share context, and keep working without confusion.

## Post-beta direction

After the core loop is reliable, Misty can deepen interoperability with tools groups already use. Candidates include richer two-way provider imports, cross-Space references, additional conversation bridges, and source-aware agent retrieval.

Every expansion should preserve the same product test: it helps a group hold one project together without forcing every participant to abandon their preferred tools.
