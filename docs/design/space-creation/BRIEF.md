# Create a Space

Status: layout approved 2026-10-08; implemented 2026-10-09 (see Implementation below). Describe it remains deferred, and the delete-refresh requirement is still open.

The current dialog is a two-step stepper (name, then template). It looks sparse, and choosing any template except Blank can fail to create the Space. This brief records what is broken, the proposed redesign, new features to choose from, and a related requirement for deleting a Space.

## Preview

The runnable React/Vite previews were removed from the repository. They remain in git history (before the dead-code cleanup of 2026-10-13); this document keeps the decisions and captured evidence.

| Query | Shows |
| --- | --- |
| `?view=current-name`, `?view=current-template` | Today's two steps |
| `?state=default` | Proposed dialog, Startup selected |
| `?state=loading` | Template grid and preview skeletons |
| `?state=blank` | Blank selected, empty name |
| `?state=invites` | Two invitees added |
| `?state=mine` | Personal templates and "Copy a Space's structure" |
| `?state=creating`, `?state=error` | Submitting, and a failed create |
| `?view=save-template` | Space settings → Save as template |

## Screenshots

Captured at 1440 × 900 (and 720 × 900 for the narrow window), 2× scale.

| | |
| --- | --- |
| Current, step 1 | [01-current-name.png](screenshots/01-current-name.png) |
| Current, step 2 | [02-current-template.png](screenshots/02-current-template.png) |
| Proposed | [03-proposed-default.png](screenshots/03-proposed-default.png) |
| Loading | [04-proposed-loading.png](screenshots/04-proposed-loading.png) |
| Blank | [05-proposed-blank.png](screenshots/05-proposed-blank.png) |
| Invites | [06-proposed-invites.png](screenshots/06-proposed-invites.png) |
| Mine | [07-proposed-mine.png](screenshots/07-proposed-mine.png) |
| Creating | [08-proposed-creating.png](screenshots/08-proposed-creating.png) |
| Failed create | [09-proposed-error.png](screenshots/09-proposed-error.png) |
| Narrow window | [10-proposed-narrow.png](screenshots/10-proposed-narrow.png) |
| Save as template | [11-save-as-template.png](screenshots/11-save-as-template.png) |

## What is broken today

1. **Templates other than Blank can fail to create.** Each one seeds a starter note, which adds account cloud bytes. Committing the create transaction then calls the billing service synchronously (`cloudusage.Commit`) while advisory locks are held. If billing is slow, unreachable or rejects, the whole create fails. Blank seeds no note, so it skips the check. A probe against the test database created Blank and failed all six others with `billing service unavailable`.
2. **One failed request blocks everything.** The dialog loads curated and personal templates with `Promise.all`. If either fails, both lists are dropped and Create is disabled, so even Blank can't be made.
3. **Personal templates are a shell.** Nothing calls the save API, and a saved template stores `apps: []`, so it creates an empty Space.
4. **Template data goes unused.** `app_ids` and `recommended_integrations` are ignored, while the step's text says "You can adjust the apps below" with nothing below it. `seed_summary` isn't shown either.
5. **Rule violations.** The template list has no loading skeleton, and the button shows "Creating..." text, which the UI conventions forbid.

## Proposed dialog

One screen, no stepper, horizontal: templates on the left, details on the right. This layout was approved on 2026-10-08 with these review changes: no "Describe it" for now, the icon and name share one row on each card, and invites are buttons rather than a comma-separated field.

- **Start from**: chips for Templates and Mine, using the shared chip variant.
- **Template cards**: a monochrome icon and the name on one row (with a checkmark at the end when selected), then a one-line description and counts ("3 tasks · 1 note · 3 collections").
- **Side panel**: Name with a live initials avatar (choosing a template fills a suggested name until you type your own), Invite people, and "You'll get", listing exactly what the template creates.
- **Invite people**: everyone you already share a Space with appears as a toggle button (avatar and first name, with a checkmark when picked). Anyone else is added with an email field and an Add button, and appears as a button that removes them when clicked.
- **Footer**: Cancel and Create Space. While creating, the button shows a spinner rather than text. A failed create says so in the footer.
- **Narrow windows**: Name and Invite move above the templates, the footer stays fixed, and the card counts stand in for the preview.
- **New built-in templates**: Trip, Event, Client work, Household and Book club, alongside today's seven.

## Features to choose from

1. **Invite while creating.** Invites send right after the Space is created, through the existing invite API.
2. **Save as template.** From Space settings, capturing channels, task titles, note outlines and collection names, never files or messages. This makes "Mine" real, with rename and delete.
3. **Copy a Space's structure.** The same capture, taken from an existing Space at creation time.
4. **More built-in templates.** The five above, with channels and a first milestone where they fit.

Deferred: **Describe it to Misty** (one sentence, then Misty drafts tasks, a note and collections for review). Add it later as a third Start from chip.

## Plan

**Phase 1: make templates work**
- Create the Space in one transaction and seed its starter content in a second, best-effort step, so billing or storage trouble can't block creation. The result reports whether seeding finished.
- Load curated and personal templates independently. Blank is always available, and a load failure never disables Create.
- Add a server test that creates a Space from every built-in template with billing stubbed.
- Wire or delete `app_ids` and `recommended_integrations`.

**Phase 2: the redesigned dialog** as shown above, with skeletons, a seed preview from the server (`seed_preview` on each template) and inline errors.

**Phase 3: the chosen features.**

## Related requirement: deleting a Space

Deleting a Space must not refresh the whole app window. Only the deleted Space's tabs and navigation should change. Everything else, including other workspace tabs, browser pages and open panes, keeps its state.

Suspects to check:
- `deleteSpace` in `src/features/spaces/store/useSpacesStore.ts` calls `load({ force: true })`, which sets the store's `loading` flag and re-reads the whole snapshot.
- `SpaceSettings.submitDelete` then navigates with `replace` and `spaceSwitch`.
- Whatever tears down the deleted Space's open tabs may rebuild more of the workspace than those tabs.

The fix should remove the Space locally, close only its tabs, and revalidate in the background without blanking any surface.

## Implementation (2026-10-09)

**Server**
- `CreateSpaceFromSource` (`server/internal/platform/postgres/space_templates_create_space_with_template_idempotent.go`) creates the Space, its tasks and collections in one transaction, then adds notes in a second one. Only notes count toward cloud storage, so a billing or storage failure now leaves the Space created with `seed_incomplete: true` instead of failing it. `POST /spaces` also accepts `source_space_id` to copy a Space's structure.
- Built-in templates (`space_templates_space_template_seed_summary.go`) carry `icon`, `suggested_name` and `seed_preview`, and include Trip, Event, Client work, Household and Book club. The unused `app_ids` and `recommended_integrations` are gone.
- Capturing structure (`space_template_capture.go`) takes task titles (with Planner access), outlines of notes the caller wrote, and collection names (with Library access). Files, messages and members never are.
- Personal templates store that capture in a new `definition` column (migration `20271009020000_personal_space_template_definitions.sql`, which drops the old `apps` column). `POST /me/space-templates` accepts `include` to choose parts.
- `GET /me/space-people` lists the people you share active Spaces with, for one-click invites.

**Client**
- `src/features/spaces/spacesShell/`: `CreateSpaceDialog`, `CreateSpaceTemplateGrid` (Templates and Mine), `CreateSpaceInvitePeople`, `CreateSpaceSeedPreview`, `useCreateSpaceDialog`, `templateIcons`. The stepper (`CreateSpaceSteps`) is removed. Blank is selected by default and always available.
- Invitations send right after the Space is created. Unsent invitations or missing starter notes show one app notice.
- Space settings has a Save as template card that opens `SaveSpaceTemplateDialog`.

**Differences from the mockup**
- Chat previews only "Everyone". Chat conversations need at least two participants, so a template can't pre-create channels in a one-person Space.
- Personal templates can't be renamed or deleted from the UI yet (the API supports both).
