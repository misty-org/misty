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

Every new public-beta route carrying a Space, Journal, Library, message,
workflow, or agent identifier must add a negative test for a different active
account and a former member before release.
