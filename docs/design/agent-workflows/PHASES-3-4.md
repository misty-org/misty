# Phases 3 and 4 execution record

Started October 3, 2026. User authorized independent implementation, subagents,
and a tracked goal. Tests are deferred until implementation is complete.
The existing working realtime companion and phase 2 folder executor remain in scope
for regression protection; phases 4a, 5 and 6 remain out of scope.

## Completion gates

- [x] Owner selected Composio Cloud; enterprise self-hosting prerequisite superseded.
- [x] Cloud auth configuration, owner consent and real account connection verified.
- [x] Owner moved OAuth branding to the separate production-launch checklist on October 3.
- [x] Composio Cloud connection active; OAuth callbacks, credential custody,
      post-expiry managed-refresh continuity, one scoped connection/tool and
      provider-disable/re-enable recovery verified against it. The internal token
      exchange is inferred from the documented provider behavior, not directly traced.
- [ ] Agent-owned native browser window, exclusive leases, takeover, resume and stop;
      no accidental control of the main window in separate mode.
- [x] Live cold-worker workflow admission, public browser research, window reveal and
      Take over; main conversation updates automatically and main browser is unchanged.
- [ ] Shared canonical invocation across Agents, floating panel and voice; stable
      admission/reconnect identities and verified result narration.
- [x] Personal methods persisted as immutable workflow/template/skill versions.
- [x] Typed inputs validated server-side; templates only seed unsent drafts;
      completed task can be saved as an editable method with provenance.
- [x] Manual and scheduled runs pin versions and inputs, use existing runtime,
      scheduler and action journal, and never silently switch execution targets.
- [x] Unavailable connections/devices and revoked methods produce truthful failure;
      occurrence replay cannot duplicate work.
- [ ] Focused final tests and actual desktop demonstrations complete.

## Canonical storage and execution

`agent_methods` owns personal metadata and enablement. `agent_method_versions`
stores immutable definitions with optional completed invocation provenance.
These records are separate from Space workflow graphs because personal agent
methods have no required Space. They introduce no second execution engine.
Existing `ai_invocations`, events, artifacts and capability checks execute each
bounded AI workflow. Inputs support text, number, boolean and explicit choices.
Required tool names are prerequisites, not grants. Missing authorization fails
before work rather than exposing a broader tool wrapper.

Existing scheduled tasks gain a pinned method version and typed input values.
Edits to the method create another version; existing schedules keep their pin.
Each occurrence retains the existing stable scheduled-task idempotency key.
Device-dependent methods cannot silently run in cloud or capture the ambient
screen when the owner is absent. Until a fresh authorized native handoff is
available to a scheduled occurrence, it records a device-unavailable failure.

Enabled skills are pinned at task admission, limited to eight per agent, and
revalidated with ownership and revocation at runtime. A skill changes guidance,
not permissions. Templates instantiate a draft without starting a run.

## Historical self-hosting dependency (superseded by Cloud approval below)

Official Composio sources identify an Enterprise Replicated/Helm distribution:
[deployment options](https://docs.composio.dev/docs/security/token-custody),
[chart repository](https://github.com/ComposioHQ/helm-charts), and
[Replicated migration guide](https://github.com/ComposioHQ/helm-charts/blob/release-stable/docs/migrate-to-replicated/README.md).
The public SDK's MIT license does not establish entitlement to all backend images.
No configured Composio endpoint, project key, enterprise registry access, or provider
OAuth connection was found in Misty's deployment configuration at the start.
A supported live deployment cannot be claimed until those prerequisites are met.
At that time, managed Composio Cloud was not authorized as a fallback. The owner
subsequently selected Cloud explicitly, as recorded below.

## Verification evidence

Implementation completed before testing began. Current verified evidence:

- Full TypeScript check and scoped ESLint pass. 47 workflow/Agents/scheduled UI tests
  and 72 handoff/execution/companion regression tests passed. Follow-up coverage passed after fixes:
  49 store/companion, seven handoff and one local-notice regression; ten native lease/receipt tests passed.
  These counts overlap and are not a combined unique-test total.
- Eight Composio client policy tests and two HTTP policy tests passed.
- Isolated PostgreSQL migrations and contracts passed: ownership, immutable pins,
  stale edits, revocation, completed-output provenance, connection grants and duplicate admission.
- A full HTTP contract exercises manual and scheduled admission under `misty_app`
  with RLS, a signed deterministic runtime fixture, real durable projection and schedule settlement.
- Real desktop + real model: “Validation · pinned greeting” ran manually with a
  required text answer. Its once-only schedule fired at 00:33 America/Los_Angeles on
  October 3, 2026, completed once, and disabled itself. Editing the method to v2
  before execution did not change the schedule’s v1 instructions or saved inputs.
  Both runs returned “Workflow verified for the supplied subject.” The disposable method was
  subsequently disabled (v3); its once-only schedule remains disabled.
- Both additive migrations (20271004010000 and 20271004020000) were applied locally.
  API is healthy. The full Docker build stalled fetching base-image metadata; the
  local deployment instead uses a successful Go Linux/arm64 cross-build layered
  over the existing development image. The previous image is tagged
  `misty-server:before-phases34`. This is not a clean production-image build claim.
- Native dev1 build and code-signature verification passed. Port 5174 was restored
  before relaunching the same signed app; its existing authenticated workspace loads.

- Real native separate-window research completed against example.com with a team
  invocation assigned to an agent window; its heading and page text returned to the
  original conversation. The main browser tab remained unchanged. A worker must not
  call the main-window screen-capture endpoint; this admission issue was fixed and
  covered by regressions.
- A user-invoked Show agent window control focuses the existing owned worker. Clicking
  before worker creation displays a local notice and cannot change canonical task
  error/state. Native ownership and handoff tests pass.
- Native Integrations displays the missing self-hosted configuration and disables
  Connect. No provider OAuth consent or external connected-account operation occurred.

## Cold-worker follow-up

A direct workflow launch exposed two cold-start defects not reached by a voice-created
conversation. Native cookie restoration for an already-active account now preserves
its jar, refresh lock and queued task. It skips account shutdown only for a valid,
unexpired matching account and compatible active browser scope; real account or
scope changes still revoke control. Three auth-cookie, four browser-sync lifecycle
and ten workspace regressions passed, followed by a signed dev1 rebuild.

A separate-window method now updates the visible work-location selector, exposing
Show agent window. Its 21-test store suite, TypeScript check and scoped lint passed.
Live Show focused the correctly owned agent window; the main Google tab stayed intact.

Fresh canonical conversations have empty persisted runtime state and no turns. Their
history projection now returns metadata and an empty messages array instead of trying
to load a nonexistent legacy Go session. Legacy sessions retain their transcript path.
The authenticated HTTP/RLS contract verifies the fresh conversation in the actual
Misty list endpoint, preserves its agent identity, excludes it from another owner's
list, then passes manual/scheduled execution. The updated API cross-build passed.

The fresh workflow subsequently admitted in `team` mode. Stopping it uncovered a
preexisting cancellation ordering defect: descendant cancellation marked the parent
terminal before the event writer ran. Parent state, one `invocation.canceled` event,
descendant revocation and durable runtime-cancel delivery now commit under one parent
row lock. The HTTP/RLS regression verifies six concurrent stops plus a duplicate,
foreign-owner rejection, exactly one event, and preservation of completed results.
The focused contract and API cross-build passed. This also repairs old canceled
records lacking a terminal event when the owner repeats Stop.

Native worker lookup now uses the owned Tauri window instead of requiring a single
webview window, so Show and reuse still work after the browser adds child webviews.
Ten workspace native tests and the signed dev1 rebuild passed.

## Final live takeover evidence

After both cold-start fixes and atomic cancellation were deployed, a new separate
workflow admitted as `invocation_9591602b-a607-43c2-990f-aaf4abe130fd` and performed
native navigation, inspection and visual reads of example.com. Show agent window
revealed the worker after browser child views existed. Take over changed the worker
to “Paused — you can use this page”; lease revocation returned 204, cancellation
returned 202, and PostgreSQL retained state `canceled` with exactly one terminal
`invocation.canceled` event after tool completions. The main conversation immediately
showed the canceled answer and Ready without a manual refresh. Its original Google
tab stayed at google.com and the signed-in account was unchanged.

The “Validation · browser takeover” method was disabled at version 4 and its worker
closed. Signed dev1 PID 13104 contains the final native fixes. No further paid test
runs were started. Workflow automatic Resume visibly remains disabled with review
and fresh-run guidance; ordinary Resume has automated coverage only.

## Historical acceptance limits before Cloud setup

The initial voice-driven takeover/resume demonstration was interrupted by billing
admission denial before a browser task could be created. The direct workflow path
subsequently passed live Take over as recorded below; ordinary Resume still has
automated coverage only. A follow-up read-only billing audit found a
current valid grant, no account closure, no open billing holds and no unfinished voice
usage journals. At that audit, 112,403 available weighted tokens were below the current policy’s
minimum new-conversation reserve of 136,544 (before history/prompt growth). This
explains why a new voice response cannot be admitted under the current allowance;
no credits, reservations, eligibility rules or billing guards were changed. Voice failures now display
in the originating conversation and persist as `invocation.failed`, without changing
an already-running task. Voice actor regressions and three real PostgreSQL voice-history
contracts pass, including idempotent failure projection and protection of successful receipts.
The rebuilt healthy local API and native UI were then checked live: the explicit billing
message appears in Agents and PostgreSQL records `failed` / `invocation.failed`. Automated native lease/receipt and frontend
handoff coverage passed; they do not establish a live ordinary-Resume demonstration.
Ordinary Resume starts a fresh invocation in the same conversation after revocation
and fresh observation. Workflow automatic Resume is disabled to avoid replaying
side effects without deterministic receipt continuation. Worker-initiated continuation now notifies the main window; authenticated history must
independently match the account, agent, conversation and invocation before reconnecting
the canonical event stream. This notification never admits or replays work. Pending, not-yet-admitted prompts survive only within the native
process; admitted runs have durable server identities.

Self-hosted Composio and physical microphone acceptance for connected research remain
unverified; passing fixtures are not a live provider deployment. Phase 3 acceptance
remains open for enterprise distribution/infrastructure access, OAuth consent, live
provider recovery checks and the combined research demonstration. Phase 4's independent
implementation and manual/scheduled evidence are complete; owner acceptance of the
connected reusable research flow depends on that Phase 3 gate.

## Additional check limitation

The existing `TestPrivateActivityDelegationAndRevocation` integration check stopped
at test Space creation (`unification_test.go:27`, `billing service unavailable`),
before reaching cancellation. It is not counted as passing descendant coverage.
The new authenticated cancellation contract and live native takeover passed; no
billing bypass or test-only credit mutation was introduced to force the older test.

## Retention audit and blocked handoff

A final database audit found no remaining voice-turn rows: their deliberately expired
execution authority was also being used by the transient cleanup job to delete saved
conversation history. The purge now preserves drawer/companion history only while its
owned conversation is retained and the account's enabled/retention settings allow it.
It does not extend invocation or device authority. Inline transforms still expire,
even when attached to the same conversation, and applied-artifact protection remains.

Three PostgreSQL voice/history contracts passed after implementation. The new check
runs the real purge: voice/drawer history survives transient expiry, inline rows do
not, shorter account retention and conversation expiry remove old history, applied
artifacts remain, and the original execution deadline is unchanged. The API build
and local deployment passed. Previously purged turns were not restored or invented.

The same external Composio dependency remained through the initial implementation
turn and both goal continuations: no configured endpoint/project/auth settings or
enterprise registry access. The selected account also remains below the minimum
voice reservation. Independent launch, cancellation and retention defects found during
verification are now addressed. Remaining acceptance needs supported distribution and
operator infrastructure, OAuth owner consent, sufficient voice admission and a live
connected-account research demonstration including physical microphone/speakers and
ordinary Resume. Phase 3 remains unaccepted; phases 4a, 5 and 6 remain out of scope.


## Composio Cloud change — October 3, 2026

The owner explicitly approved Cloud integration and supplied a project key in the
ignored `server/.env/dev/composio.env`. This supersedes the historical self-hosting
requirements above and the old blocked goal's distribution requirement. No enterprise
license or Helm deployment is now required. Do not mark the original phases goal
complete merely because the deployment decision changed.

Cloud mode is explicit and restricts API calls to `backend.composio.dev`; browser
Connect Links are restricted to `connect.composio.dev/link/<id>`. Project credentials
stay on the server and API redirects remain disabled. Cloud connection identities
also pin the auth configuration. Dev/prod Compose load their own optional key files.
The account UI no longer claims the provider is self-hosted. Existing per-owner,
per-agent, per-calendar and pinned-version execution boundaries remain in force.

The supplied project key successfully retrieved the live
`GOOGLECALENDAR_EVENTS_LIST` catalog entry at version `20261001_00`; query and fields
match the adapter. The owner's custom Calendar auth configuration is now enabled
and its scope was narrowed and verified as `calendar.events.readonly`. Misty's
Connect action created the authorization flow, but Google rejected it with
`redirect_uri_mismatch`. The live callback is
`https://backend.composio.dev/api/v1/auth-apps/add`; the owner registered it and the
retry reached Google's passkey verification. The owner completed consent and
explicitly approved read access to `primary` for Misty. Misty's Integrations screen
confirmed “Connected · Allowed for this agent.” The account chooser displays
`composio.dev` and the success page still says “Composio to Google Calendar,” so
branding remains unaccepted. Google brand verification and Composio Connect Link
branding remain launch requirements; use a Misty-domain callback relay if removing
Composio's redirect domain is required.

The first real read succeeded through the production Go Composio adapter:
`GOOGLECALENDAR_EVENTS_LIST`, version `20261001_00`, receipt `log_ZuGIVIgReG_z`.
It read `primary` for October 3, 2026 in America/Los_Angeles, returned zero events,
and had no next-page token. The temporary verification helper loaded the existing
active owner/agent binding, checked the configured instance, then called the same
adapter; it was removed afterward. No events were written. This is a provider
adapter smoke check, not an LLM/runtime-journal acceptance result.

The preceding real UI prompt in conversation
`conversation_5e69ad3a-6f2a-4eb5-afa7-5a5e2ea10a61` failed before model execution:
“Voice could not start because billing did not authorize this response.” The
user's text prompt therefore did not run a tool through the agent loop. The
chat/billing boundary and combined research/ordinary Resume acceptance limits
remain unresolved; do not mark all phase 3–4 acceptance complete.

Cloud validation after implementation: all 13 Composio client tests and both
Composio HTTP API tests passed. The changed integration component passed ESLint and
the UI mechanical detector. The normal development API image built successfully,
was recreated, and returned a healthy `/health` response. These checks do not
substitute for the pending combined agent/browser/voice demonstration.

## Final acceptance follow-up — October 3, 2026

The owner moved Google/Composio branding to the production-launch checklist in
PLAN.md; functional acceptance still requires the actual connected agent flow.

The owner authorized replenishing the development account. The existing signed
billing refund API reimbursed 811,222 weighted tokens across 41 documented
folder, voice, screen and phase 3–4 acceptance-test reservations. Original usage
receipts remain; idempotent reimbursement receipts were added. Available allowance
became 923,625 before new acceptance work. The weekly limit stayed at 1,000,000,
ordinary email-query usage of 76,375 was preserved, and no billing guards or database
balances were edited directly. Detailed local audit: `/tmp/misty-development-reimbursement-20261003.json`.

A live Composio failure/recovery check temporarily disabled the already-authorized
Calendar connection through the provider's documented status API. The production
Misty adapter denied its Calendar call with `ErrAccount`. Restoring the existing
connection enabled a successful read with receipt `log_YellAkcVOaWk`; final provider
status was ACTIVE and not disabled. No scope or calendar event changed. This proves
provider disable/recovery and account-state revalidation, not expiry-driven token
refresh or Google-side consent revocation.

The agent overview now includes Composio connections and selected-agent Calendar
read scope alongside MCP accounts. It refreshes on return from Integrations and
excludes stale account/agent results. Six focused UI tests, the full TypeScript
check, scoped ESLint, UI mechanical checks and scoped diff checks passed. The real
desktop overview displayed “My Google Calendar — Calendar read allowed · primary.”

Live ordinary browser task `invocation_39176094-8640-4809-8491-0a5e1a48c4f3`
was canceled by Take over. Its worker became “Paused — you can use this page.”
After navigating the paused worker to Google About, Resume admitted
`invocation_96d87603-0842-446a-b3a9-8cff2724e0f3` in the same conversation
`conversation_866ae9f7-5492-4c56-9043-d953e2f12fb5`. Its first tool was a fresh
`browser.inspect`. That inspection exposed a missed native job wake after
reconnection; the combined result remains unaccepted until recovery is repaired
and verified. No Calendar write or saved-note success is claimed by this attempt.

The follow-up awake task navigated successfully but its next inspection waited
about 84 seconds and returned an uncertain receipt. Device claim reconciliation
now recovers missed notifications, and the shared native event feed rechecks
connectivity after listener registration and on a bounded local liveness timer.
It falls back to authenticated SSE when disconnected; account/session isolation
and native execution leases remain enforced. Ten account-event tests and twelve
focused worker tests passed, along with scoped lint and TypeScript checks. Native
failure receipts now retain only allowlisted diagnostic categories, never raw page
text, and uncertain work is not replayed automatically.

A subsequent single-inspection task (`invocation_91b579e0-ea95-46f0-9d86-bae2121feed3`)
was interrupted by macOS clamshell sleep from 10:59:13 to 11:07:11 Pacific. Its
unstarted device job expired and was canceled during runtime reconciliation.
This interrupted check is not counted as a successful browser demonstration.

Billing verification exposed accumulated model-step reservations and a terminal
callback that skipped settlement after cancellation. Signed, raw provider usage
now settles each completed model step through the durable billing outbox. Final
aggregate settlement subtracts those measured receipts and settles only remaining
holds; per-run serialization and stable keys protect retries from duplicate charges.
Public lifecycle token fields remain redacted. The runtime output limit now matches
the admitted 2,200-token maximum. Focused Go tests, an isolated PostgreSQL signed
callback contract (cancellation, late usage and duplicate callbacks), runtime
TypeScript and fourteen workflow-completion tests passed. Unknown usage is not
invented or treated as zero. Deployment and live acceptance follow these checks.

The final accounting implementation passed a constrained-connection-pool regression
as well: its advisory lock and autocommit journal use one owned connection, so
concurrent callbacks cannot exhaust the pool while borrowing a second connection.
Normal API and runtime Docker builds passed and the development services were
recreated and health-checked. Both historical holds were reconciled through signed
callbacks using persisted provider usage: 452,000 held tokens settled to 49,080
actual tokens, leaving 725,431 available and zero held. Task states did not change.
Local provenance: `/tmp/misty-runtime-held-usage-evidence.json` and
`/tmp/misty-runtime-held-usage-recovery.json`. No further refund or limit change
was used for this recovery.

The CLI environment registry now recognizes the existing Composio key and
configuration files for development and production, retaining private-file checks,
unique variable ownership and redacted validation errors. Twelve environment tests
passed and the development CLI was rebuilt.

The rebuilt native worker disables WebKit background throttling, matching the main
window's existing policy, while retaining the 30-second execution lease and all
account/task checks. Safe denial diagnostics distinguish missing/expired leases
from mismatched bindings without exposing page content. Eleven native workspace
tests and two diagnostic tests passed. In the fresh desktop run
`invocation_dadde5dd-9cc0-464c-8c72-954ce2187bd4`, navigation, inspection and visual
inspection all completed; queued-to-start times were 281, 106 and 112 ms. This
proves the browser actions, but the final completion callback exposed a separate
billing aggregate-detail mismatch and is not yet a completed acceptance run.

That mismatch is repaired and deployed: final aggregates may omit optional cached
and reasoning counters that individual checkpoints supplied. Settlement validates
the authoritative input/output totals and compares optional counters when present;
an explicit contradictory zero remains an error. Regression checks and the normal
API Docker build passed. Replaying the original signed completion returned HTTP
200, preserved the subsequently canceled task, and added no charge or hold. Its
four measured model steps cost 72,578 weighted tokens. The desktop had sent the
cancellation requests; native leases had continued renewing successfully. A new
completed run is still required, rather than relabeling that canceled task.

### Post-expiry connected-account continuity

The production Go Calendar adapter succeeded again at 19:15:03 UTC on October 3
with receipt `log_ZJRDtHQbSJHx` (zero events for the authorized primary calendar's
October 3 local day). Before that call, Composio reported connection creation at
17:21:24.563 UTC, last update at 17:43:55.324 UTC, and `expires_in: 3599`. After the
call, its update timestamp was 19:15:03.185 UTC and status remained ACTIVE. No new
authorization, account mutation or provider-token handling was performed by Misty.
This is black-box evidence of continued scoped access beyond the reported original
credential lifetime, consistent with Composio's documented automatic refresh;
it is not an internal refresh-token trace. Sanitized evidence is in
`/tmp/misty-composio-refresh-metadata.json`,
`/tmp/misty-composio-post-expiry-read.json` and
`/tmp/misty-composio-refresh-metadata-after.json`.
The deprecated `/refresh` endpoint re-initiates OAuth and was not called.
Sources checked: [connected account lifecycle](https://docs.composio.dev/docs/auth-configuration/connected-accounts)
and [v3.1 account details](https://docs.composio.dev/reference/api-reference/connected-accounts/getConnectedAccountsByNanoid).

### Remaining desktop acceptance

After the accounting fix, the next combined desktop check was interrupted by
concurrent owner navigation. No new run was submitted. Subsequent read-only checks
showed the owner moving through Files/Transfers; the prior browser task is terminal
and there is no acceptance job still running to wait for. Desktop testing awaits
owner confirmation that the window is available. The outstanding demonstration is
one completed browser/Calendar task with saved-note readback, ordinary takeover and
successful resume in the same conversation, and physical voice result verification.
These gates remain unchecked; no phase 4a or cross-agent work has started.

### Website-task handoff correction

The owner's October 3 playlist request exposed a real failure after initial
implementation: invocation `invocation_c14af294-d140-4e39-8de6-ee9195c173e2`
was admitted without browser context in conversation mode. The companion weakened
the requested playlist into a plan; the task then reported missing browsing
capabilities while its runtime marked it completed. This is not successful task
execution and does not satisfy phase 3 acceptance.

The correction adds an explicit browser requirement to companion delegation.
Website work in conversation mode routes to an owned separate browser, while an
already selected execution target remains selected. Current-screen observation
is distinct and cannot be combined with browser routing. Delegation must preserve
the requested deliverable. Task completion also requires a structured outcome,
with partial or blocked work remaining unsuccessful. The historical failed outcome
has not been relabeled as a success.

Post-implementation checks passed: 61 frontend tests, frontend TypeScript and scoped
lint, focused Go conversation tests, runtime TypeScript and 19 focused runtime
tests, plus the incomplete-result unit test. The six-scenario completion contract
also passes, including durable blocked explanations, callback replay, permanent
quota failure, transient accounting failure and canceled-task accounting. The API
and agent runtime were rebuilt with their normal Docker builds, deployed to the
development stack, and reported healthy. The new terminal reporting requirement
still needs a real task replay; prior live workflow evidence predates this change.

The attempted desktop replay could not submit a task: the UI-control tool repeatedly
reported that the app changed, and a refreshed accessibility target became invalid.
The visible app alternated between Google and the existing playlist conversation.
This is recorded as a control interruption, not proof of deliberate owner action
or a passed live test. No new playlist or verification task was submitted.

### October 3 evening continuation: completion, takeover and saved delivery

The owner requested continuation from the other chat. Focused frontend checks
passed (65 tests across five suites and TypeScript), including the separation of
Stop audio from Stop task. Runtime checks passed (30 tests across four suites and
TypeScript). Physical microphone loss and speaker playback were not demonstrated
by these automated checks.

The live read-only house inspection `invocation_c1be64a4-dd21-4ec4-b10d-9892f528787c`
exposed a completion-parser defect: the pinned WorkflowAgent SDK supplies executed
tool receipts in top-level `toolResults`, whereas the parser expected them inside
step content. The runtime now matches exactly one successful completion receipt
to its final tool-call ID, rejecting mismatched, missing, duplicate and malformed
receipts as well as later work. The normal runtime Docker build passed and the
development runtime was recreated healthy. Ordinary Resume produced completed
invocation `invocation_051ee31c-8dfe-4ff6-81f2-e5c2971af2f9`. Its house description
matched an independent native screenshot. The historical failed run remains failed;
this read-only verification did not prove a fresh Midscene drawing.

Combined research invocation `invocation_52f0865f-e5ba-4c80-9529-8642b9dab337`
read the live browser and authorized primary Google Calendar. Take over paused
the native browser and canceled that invocation. While paused, the canvas zoom
was changed to 90%, preserving its shapes. Resume admitted
`invocation_e9513318-9412-45a9-b0dc-cd3599a97775` in the same conversation
(`conversation_6d1bd2b1-0dd0-480b-89a0-999c095cdf5a`). Its first tool freshly
inspected the browser, then it repeated the scoped Calendar read and researched
Excalidraw's documentation. Calendar returned zero events for October 3 in
America/Los_Angeles. No Calendar or drawing writes occurred.

That run created exactly one note, **Phase 3 acceptance — Excalidraw and Calendar**,
in the owner's Personal Space: `note_f9cc554c-184f-443d-9566-009771b76aa2`.
It correctly reported a partial outcome when subsequent notes.read calls could
not read its body. The initial collaboration bootstrap was durable but did not
publish its projection: the signed server control envelope omitted resource_id,
which previously arrived only when an editor connected.

The API now signs that resource binding; the Worker validates it, rejects
conflicting bindings, and publishes the original durable body on an idempotent
bootstrap replay. A signed-envelope Go regression, five black-box Worker lifecycle
tests, eight Worker control/persistence tests and Worker TypeScript passed. The
normal API Docker build passed. The development Worker deployment succeeded
(version `90f25739-85e7-4340-9ffa-6dd3a13682db`) and the development API was
recreated healthy. The initial CLI deployment failed from Docker disk exhaustion;
the existing installed Wrangler deployed the same development Worker configuration.
Production was not deployed.

Recovery replayed the original bootstrap, with verified owner/Space binding and
the signed resource ID, to the development Worker. It returned initialized:false
and published the original body at collaboration revision 1 without overwriting
content. A subsequent real agent task,
`invocation_fdd3ca68-7dd1-4d74-a422-942fcff09c71`, completed after notes.read
verified the saved body, its Excalidraw citations and the recorded zero-event
Calendar count. This verifies recovered delivery and readback, not a new website
or Calendar observation or a newly created note after deployment. The resumed
partial task was not relabeled as completed.

The worker's Message this agent path returned HTTP 502 from follow-up routing
before admitting another task; the supported main composer was used for the
combined research and verification. Subsequent
desktop-control calls timed out, so no fresh drawing, live Stop audio/task
continuity check, or physical microphone/speaker narration is claimed. The owner
chose to test physical voice later while the other checks continue. Phase 3 remains
unaccepted and phases 4a, 5 and 6 remain gated.

Follow-up investigation found an instruction transport defect in the no-tool
completion path: it folded system instructions into the user message, leaving
agent_instructions_and_context empty despite the provider's authoritative persona
rules. Read-only completion now retains the separate instruction field, and the
router explicitly places its serialized route object inside the provider's
required text field. Two regressions cover authoritative instructions and
unchanged ordinary completion; the full agents unit suite, internal agents tests
and HTTP API tests passed. The normal API Docker build passed and the development
API was recreated healthy. Docker disk exhaustion was resolved by pruning unused
build cache last accessed over one hour earlier (533.7 MB); no volumes or running
images were removed. The live routing replay remains open because native app
control still timed out after reconnecting and resetting the control session.

### Remaining acceptance requirements after the continuation

The current evidence is narrower than the complete phase 3 gate in PLAN.md:

- [x] Read-only browser completion persists a successful terminal outcome.
- [x] Ordinary takeover and Resume re-inspect the native target in the same
      conversation; the earlier invocation remains canceled.
- [x] Scoped Calendar research and recovered saved-note body readback are verified.
- [ ] A fresh combined browser/Calendar/save/readback task completes after the
      note-delivery fix, without requiring an operator bootstrap replay.
- [ ] A fresh Midscene drawing task reaches successful completion with a final
      visual observation and an independent native screenshot.
- [ ] Worker Message this agent routing succeeds live after the instruction fix.
- [ ] An admitted browser task survives live Stop audio/microphone interruption;
      explicit Stop task and account/device isolation still hold.
- [ ] Connected research is repeated through Talk to Companion using real
      microphone input and speaker output; its spoken conclusion matches its
      persisted artifact and execution receipts. Summarizing an existing note
      would establish result narration only, not this complete voice path.
- [ ] Live device reconnection demonstrates truthful state and target restoration;
      automated reconnect/account-generation tests alone do not prove it.

On the next goal turn the development API and runtime were healthy, and the
latest note-verification invocation remained completed. Native app control
recovered after the app restarted, and the retained conversation/result were
visible. Attempts to select the separate execution target were then interrupted
by active-tab changes back to Google before a new task was submitted. The owner
was asked whether the shared app was available for acceptance testing; physical
voice testing remains deferred at the owner's request. No new drawing task or
live routing result is claimed from this observation.

Keyboard selection subsequently succeeded, and fresh drawing invocation
`invocation_9abe6fb0-444f-4b0c-a0ad-851f9be59229` was admitted in the existing
conversation. Its native browser actions completed, but Midscene's next model
request was rejected by Vercel AI Gateway for lack of a positive credit balance.
The durable outcome is failed with a matching visible explanation; the browser
retained the original house and paused controls. There is no successful fresh
drawing or live follow-up routing claim. Provider funding must be restored before
further paid model acceptance work. The owner was asked to restore that external
balance; Misty's account allowance, provider choice and billing safeguards were
not altered. Physical microphone/speaker testing remains separately deferred.

A read-only follow-up checked the running runtime's provider configuration and
the official Gateway credits endpoint. The runtime still uses Gateway;
GET /v1/credits returned HTTP 200 with balance **-0.02724419 USD** and lifetime
usage **15 USD**. No model request, balance purchase, credential change or limit
change was performed. The drawing invocation remained failed, with all thirteen
native jobs completed and no queued, leased or executing jobs. The funding blocker
is therefore still present; there is no live run to wait for or restart blindly.
Vercel's [credits and usage reference](https://github.com/vercel/vercel-plugin/blob/main/skills/ai-gateway/references/spend-observability.md)
documents this read-only balance endpoint and the positive-balance requirement.
