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
| Personal Agents, private Agent memory, and conversations | Agent definitions and approved versions remain while the owner account is active; private conversations expire after 30 days | A deletion request immediately disables owned Agents, Space memberships, and active runs. At purge, private conversations and member-scoped memory are deleted, behavioral instructions and versions are redacted, and shared Task/audit records retain only historical attribution |
| Agent Task runs and durable jobs | Retained with their Space Task and audit history | Reassignment, Agent removal, or account deletion cancels active work. Private run input/output belonging to a deleted requester is redacted at account purge |
| Collaboration ticket/JTI | Ticket lifetime plus five minutes | Durable Object replay marker is opportunistically swept |
| Support bundle | Local only | Created only on user action; never uploaded automatically |

Production operators must separately set and document:

- API/Worker/edge log retention and access controls
- PostgreSQL backup/PITR window and expiry
- R2 version/deletion-protection retention
- telemetry retention in the selected region/project
- legal-hold and litigation-preservation overrides

Backups expire on their configured schedule; an account cannot be selectively
removed from an immutable backup. Restored systems must reapply completed
deletion tombstones before serving traffic.
