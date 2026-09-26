# Maintaining the Misty roadmap

[Public overview](../../ROADMAP.md)

## One record per item

Keep the public outcome, engineering acceptance criteria, current state, next
action, and sanitized evidence together. Do not maintain an independent public
checklist and private checklist for the same item. Private evidence can live
elsewhere; its public record should explain what was verified without exposing it.

The overview contains direction and links. Area pages contain the canonical item
records. Existing engineering ledgers remain authoritative for items that have
not been migrated; link and map their IDs rather than silently replacing them.

The browser items use stable IDs `B01-01` through their milestone's last item.
Never renumber an item because its order changes. Add new IDs for new scope.
Retain completed and deferred records, with reasons and links to replacements.

## Status definitions

| Field | Values and meaning |
| --- | --- |
| Work | `exploring`: scope undecided; `planned`: accepted queue item; `in_development`: assigned active work; `blocked`: named dependency prevents progress; `deferred`: deliberately postponed with reason; `complete`: all stated acceptance criteria verified. |
| Implementation | `not_assessed`: code coverage unknown; `not_started`: confirmed missing; `partial`: some criteria implemented; `implemented`: required code exists; `not_applicable`: verification/documentation-only item. |
| Validation | `not_recorded`: no attached evidence; `automated_only`: named automated checks passed; `manually_verified`: named manual checks passed; `acceptance_verified`: all criteria and required failure/recovery paths verified on the declared platform/build. Keep automated and manual evidence even when the summary label changes. |
| Availability | `not_confirmed`: no verified distribution record; `development_only`: available in an identified development build; `preview`: limited early access; `beta`: identified beta release; `released`: identified public release. |

These are independent fields, not one progress ladder. Validation and availability
must name platforms; if Mac and Windows differ, give each its own row. A build
passing compilation is not manual website validation. Source inspection is
implementation evidence, not an end-to-end test. A test failure or changed code
can reopen an item; preserve the previous evidence and explain what invalidated it.

The browser migration preserves the original first milestone's “in progress”
label but leaves item statuses unpromoted. There was no item-specific completion
evidence in the original ledger. Inspect the current working tree and coordinate
with any active owner before starting a queued item.

## The iteration loop

1. Select the first ready, unfinished item in the accepted milestone order.
   Check its dependencies and owner. If blocked, record why and choose the next
   ready item; do not expand scope merely to stay busy.
2. Record the owner, today's date, current implementation assessment, and a
   concrete next step. Define observable acceptance before editing code.
3. Implement a reviewable slice. Attach the commit/PR or identify the development
   revision honestly if the working tree is not yet committed.
4. Run relevant checks and the necessary real user flow. Record platform, build,
   steps, results, and limitations. Keep failed checks visible until resolved.
5. Update implementation and validation separately. Mark complete only when the
   item's acceptance is established. Add release availability only with evidence.
6. Record a short dated update and the next ready item. Split newly discovered
   work into stable follow-up IDs with dependencies instead of losing it in chat.

The initial next review target is `B01-01`. Browser baseline work precedes
expansion of browser agent features, as the accepted browser plan specifies.

## Growing beyond the browser

Migrate one area at a time. Review existing records for current product scope,
assign stable IDs, retain acceptance and evidence, and replace old duplicate
checklists with links only after every item has a mapping. In particular, preserve
the IDs and release gates in the existing agents readiness ledger during any
future migration. Do not convert historical passes into current release claims.

Files, shared work, device continuity, and agents need this reconciliation before
the public overview can claim to be a complete product inventory.

## Keeping a long roadmap manageable

Start with Markdown in Git: it is easy to review, link, edit, and read on GitHub.
The browser currently has one file per small milestone. When an area becomes
hard to scan, move an item into its own file using the template; retain its ID
and a link at the old location so incoming links still lead readers to it.

Frontmatter on area pages describes that milestone, not every item's readiness.
Individual records currently use readable fields. If a searchable website or
automated reporting is added, normalize those records into one item per file
with validated frontmatter first. Render the website from those same records;
do not introduce a second editable status database.

Keep detailed test logs in linked evidence files and concise dated summaries in
the item. Move long historical update logs to a linked archive without deleting
the current item. Use Git history for the exact changes. Do not duplicate release
notes manually in every overview.

## Public evidence

Use durable, repository-relative or public links. Do not publish credentials,
cookies, personal messages, private screenshots, local machine paths, internal
service addresses, or private operational records. A private log is not public
proof; provide a sanitized description and clearly say when evidence is private.

Adding roadmap files locally does not publish them. Publication happens through
the repository or website's normal release process.
