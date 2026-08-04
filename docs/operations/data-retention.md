# Public beta data retention

This is the operational retention schedule implemented by the application.
Published legal wording must match it before public beta.

| Data | Active retention | Deletion behavior |
| --- | --- | --- |
| Account profile and settings | While account is active | Deletion request revokes sessions and provider access immediately; profile is anonymized after the 30-day recovery window |
| User-controlled OAuth credentials | While connection/account is active | Provider revocation is attempted before encrypted local credentials are erased; failures retry |
| Authored Journal document | While its shared Space/resource is active | Account deletion revokes the departing member immediately; the Space's normal archive/purge lifecycle decides when shared content and its Worker state are deleted |
| Journal/Library binary object | While any active database reference exists | Reference-aware cleanup removes the R2 object only after its last reference and safety window; legal holds prevent deletion |
| Abandoned upload | Until reservation expiry plus reconciliation safety window | Reservation is released and an old unreferenced object is deleted without opening its body |
| Shared Space messages/files | While the Space retains them | Leaving or deleting an account removes access but does not silently erase data other members rely on; authored content is anonymized where the schema permits |
| Personal Agent definitions and Space placements | Definitions and approved versions remain while the owner account is active; Agent messages follow their Space conversation's retention | A deletion request immediately disables owned Agents, placements, device grants, and active runs. Shared messages, Tasks, runs, and audit records retain neutral historical attribution; obsolete private-session memory is not retained or exported |
| Agent runs and durable device jobs | Retained with the triggering Space conversation, Task, and audit history | Reassignment, placement removal, device-grant revocation, or account deletion cancels active work. Requester-owned sensitive run input/output is redacted at account purge |
| Conversation-scoped resources | Retained with the source conversation unless their human creator explicitly shares them with the Space | Conversation deletion archives and purges private Tasks, native events, Journal items, roadmaps, Library items, suggestion bundles, and follow-ups through their normal retention path; Space-shared resources survive |
| Action suggestion bundle | Seven days if untouched; accepted results follow the created resource/run retention | Personal dismissal removes only that viewer's card. Evidence stores message identifiers and hashes, never detector reasoning or conversation text |
| Scheduled Agent follow-up | Until delivered, canceled, or terminally failed; delivery records follow the source conversation/run audit history | The authorizer may cancel the whole reminder and recipients may opt out. Revoked authorizers/Agents cancel delivery; removed recipients are skipped |
| Collaboration ticket/JTI | Ticket lifetime plus five minutes | Durable Object replay marker is opportunistically swept |
| Support bundle | Local only | Created only on user action; never uploaded automatically |

Production operators must separately set and document:

- API/Worker/edge log retention and access controls
- PostgreSQL backup/PITR window and expiry
- R2 version/deletion-protection retention
- telemetry retention in the selected region/project
- legal-hold and litigation-preservation overrides

Suggestion telemetry is metadata-only: detector latency, status, action kind,
allowance consumption, and failure codes. Conversation text and proposed field
values must never be emitted to product analytics or operational metrics.

Backups expire on their configured schedule; an account cannot be selectively
removed from an immutable backup. Restored systems must reapply completed
deletion tombstones before serving traffic.
