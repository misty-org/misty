# Independent habit tracker

This is a standalone backend app using only published Misty SDK contracts. It
exposes `habits.list` and `habits.record`, without catalog membership, an official
app exception or a provider-specific harness branch. Each private instance serves
one account. SQLite commits a habit and its effect receipt together; duplicate
requests replay the original protected provider response across restarts.

The adapter and app-scoped RPC client are tested. Live installation, conversational
agent discovery and the agent → habits.record → Journal summary scenario still need
end-to-end validation. This directory does not claim that those release gates pass.

## Run locally

Use Node 24 or later. From the SDK repository, build the packages with `npm run
build`, then run `npm test --prefix examples/habit-tracker`. The example's file
dependencies can also be installed in its own directory; they are replaceable with
published package versions when released.

Generate a private random `HABITS_BACKEND_TOKEN` of at least 32 characters and set
it in the service environment. Start with `npm start --prefix examples/habit-tracker`.
`HABITS_DATABASE` chooses the SQLite file; its default is `./private/habits.sqlite`
relative to the process directory. The service binds to loopback port 4319 (`PORT`
overrides it). Expose `/execute` through a trusted HTTPS reverse proxy for Misty's
outbound transport. Plain HTTP and private endpoints are not production provider
routes. Do not put the credential in a browser, app manifest, model context or URL.

## Sign and install

Run `node examples/habit-tracker/sign-manifest.ts /absolute/private/directory`.
It creates a mode-0600 Ed25519 publisher key and an `installation.json` containing
the signed UTF-8 document and digest. Keep the key for updates; changing it is a
publisher change. Never commit or distribute the private directory. Signer
continuity does not certify a publisher's identity or reputation.

Review the installation document, particularly its scopes and provider declaration.
Use trusted account controls to submit that exact artifact to
`POST /v1/me/sdk-apps/install`. Create an app session through
`POST /v1/me/sdk-apps/example.habits/sessions` with `{}`. The returned app token is
for the app client only; the backend receives its separate connection credential.

Use `createHabitClient({apiURL, appToken})` from `client.ts` to call
`register(reviewedDigest)`. Registration initially reports unavailable. After the
backend is running, report its readiness with
`client.capabilities.reportAvailability("example.habits/backend", {state:
"available", observedAt: new Date().toISOString()})`. Report authentication or
availability changes as they occur; Misty refuses execution while the provider is
not ready. Configure the declared backend connection through
trusted account controls:

- `PUT /v1/me/sdk-apps/example.habits/connections/10000000-0000-4000-8000-000000000001`
  with `{expectedRevision: 0, endpointURL: "https://your-provider/execute",
  bearerToken: "<the private service credential>"}`.
- `POST /v1/me/sdk-targets` with a new UUID `targetId`, `expectedRevision: 0`,
  `providerId: "example.habits/backend"`, `providerVersion: 1`, a recognizable
  `label`, `capabilities: ["habits.list", "habits.record"]`, and
  `callerApps: ["example.habits"]`. An account target omits `spaceId`.

For a conversational Misty run, bind the target explicitly to its `spaceId` when
configuring it. Account-only targets are not implicit authority to expose private
provider data in a Space conversation. New runs snapshot authorized Space-bound
target versions; target changes require a new run and do not expand a delegated run.

Misty must have both provider admissions and SDK execution enabled, with its
TypeScript durable runtime configured. Installation grants access to the requested
scopes; registration grants no additional permissions. Only trusted user controls
can configure credentials/targets or approve a write. Keep the generated target ID
and revision explicit rather than selecting whichever target appears first.

## Invoke through the SDK

```js
const app = createHabitClient({ apiURL, appToken });
const { targets } = await app.capabilities.resolveTargets({
  capability: "habits.record", targetId: savedTargetID,
});
if (targets.length !== 1) throw new Error("The saved target is unavailable.");
const request = app.prepareInvocation("habits.record", {
  name: "Walk", day: "2026-09-07", note: "Around the park",
}, targets[0]);
// Persist this exact request before submission; retries must retain its deadline,
// input and requestId rather than create a new logical action.
const accepted = await app.capabilities.invoke(request);
const progress = await app.capabilities.result(request.requestId);
```

The submitted invocation stays immutable. When Misty executes it, the backend
envelope may carry a shorter deadline for that attempt's remaining execution
allowance. New adapter receipts fingerprint the logical effect without that
transport deadline, so an already committed result can replay after a deadline
change or expiry. Expired new effects are refused. Receipts from the earlier sample
format still support replay of their exact original envelope.

When the result is `waiting`, show its reason and approval ID to trusted user
controls. Those controls can approve/deny with
`POST /v1/me/sdk-runs/{accepted.runId}/approvals/{approvalId}`. An app bearer cannot
call that route. Poll the same request after approval; never invoke a new write to
work around a wait. The SDK result reports confirmed evidence, failure or
uncertainty. It does not infer completion from a confident agent response.

`habits.list` accepts `{cursor?: number, limit?: number}`. Follow `nextCursor` until
null for a complete listing; each page explicitly reports whether it is partial.
A target switch, changed input under one effect ID, expired new action or mismatched
idempotency header is rejected before mutation.

## Remaining integration proof

Run against the real public package snapshots and a disposable Misty installation.
Verify install/register/invoke/result/uninstall, provider restart after a committed
write and a lost response, revoked grants and target revisions. Then connect the
ordinary conversational agent registry path and demonstrate an agent recording a
habit and writing a Journal summary under explicit cross-app authority. The sample
has no account-wide Journal credential and must not acquire one to shortcut that
proof.
