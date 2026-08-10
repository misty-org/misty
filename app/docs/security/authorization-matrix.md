# Public beta authorization matrix

Authorization is enforced by the API/database and collaboration Worker. The
desktop UI is not a security boundary.

| Boundary | Required behavior | Regression evidence |
| --- | --- | --- |
| Guessed Journal identifier | Return the same not-found result as a missing document | `db.TestUnauthorizedNoteLooksExactlyLikeAMissingNote` |
| Cross-Space Journal access | Outsider has no view, edit, delete, or presence access | `db.TestNonMemberHasNoNoteAccess`, `api.TestRealtimePresenceRejectsNonMembers` |
| Former Space member | Access and event replay stop immediately | `db.TestFormerSpaceMemberLosesNoteAccess`, `db.TestFormerMemberCannotReplayNoteEvents` |
| Revoked account session | Authentication fails after deletion begins | `db.TestAccountDeletionLifecycleRevokesAccessAndAnonymizes` |
| Viewer collaboration socket | Document writes are refused | Journal Worker viewer-write policy/runtime tests |
| Permission revoked on open socket | Control closes the affected socket and increments the ACL version | Journal Worker control/runtime lifecycle tests |
| Replayed/expired collaboration ticket | Connection/export is refused | Journal Worker ticket and runtime lifecycle tests |
| Guessed Library identifier | Database RLS and API authorization refuse access without opening object bytes | Space Library database/API integration suite |
| Signed asset URL | Exact key, checksum, size, MIME, and expiry are bound; the API never proxies Journal bytes | Library presign/direct-transfer tests |
| Agent Space action | Requester permission, Agent role permission, pinned-version capability grant, conversation/resource visibility, and risk approval must all allow it | Space Agent membership, Toolbox, and run authorization suites |
| Agent conversation isolation | Context is limited to the current conversation plus permitted shared Space resources; another direct or limited-group conversation is never included | Conversation-context and cross-Space isolation tests |
| Device action | The grant must match requester, Space, Agent, online device, opaque scope, capability, expiry, and revocation state | Agent device-grant and workflow-device-job contract tests |
| Conversation resource audience | Private-chat Tasks, events, Journal items, roadmaps, Library items, search results, Agenda entries, activity, exports, citations, and realtime events are visible only to current human participants; ownership is not an override | Resource-audience, event-filtering, and conversation-isolation suites |
| Action suggestion detector | Disabled unless the Space owner opts in; no current participant may have a veto; only the source conversation's bounded human transcript may be evaluated | Suggestion settings, veto, agreement-gate, and cross-conversation corpus tests |
| Suggested action acceptance | Viewer permissions, participating Agent, pinned version, capability grant, destination audience, and provider/device state are recomputed; execution is locked to the reviewed tool and payload | Suggestion acceptance concurrency, stale-permission, and exact-payload tests |
| Scheduled follow-up | Delivery uses exact approved text, never rereads the source, skips former participants, and targets each recipient's canonical DM with the selected Agent | Follow-up delivery, removal, revocation, partial-delivery, and loop-prevention tests |

Every new public-beta route carrying a Space, Journal, Library, message,
workflow, or agent identifier must add a negative test for a different active
account and a former member before release.
