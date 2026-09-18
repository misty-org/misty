# Automation/browser integration, protocol 1

The browser shell owns website selection, sign-in, profiles, and presentation.
Automation consumes opaque targets and scoped browser operations. It must not
extract cookies or replace the shell's UI.

`MistyCapabilityManifestSchema` describes owner-qualified providers and their
semantic capabilities. `defineMistyCapabilityManifest` validates a declaration;
it does not install, authorize, or execute it. The host must accept registration
only when the authenticated installation contains the matching verified manifest
digest. Go now implements signed independent installation, registration,
unregister, availability reporting, discovery, backend target resolution and all
public invocation/result/cancellation routes. Backend execution uses the existing
Go registry, durable TypeScript runtime, target checks and effect journal.
Managed Misty conversations and quick AI requests also discover their admitted
backend capabilities through that registry. Browser/native/view execution and
host target validation remain unfinished; their declarations are not executable
merely because these helpers exist. The registration digest covers the exact signed installation document,
not just its embedded capability manifest. See the server documentation at
`docs/sdk-provider-installation.md` for its signature and review format.
Provider versions and target revisions are immutable execution dependencies.

`MistyCapabilityTargetSchema` is the integration boundary. Browser targets bind an
app/provider to a device, host-issued profile identity, account binding, exact
HTTPS origins, and an optional current view context. The durable target ID is
different from the ephemeral browser handle/context. Reopening a target must use
the same profile and revalidate the account; it must not resolve to the active tab.

Availability distinguishes device, authentication, account confirmation, closed
view, revocation, and provider failure. Session cookies remain on the device.

Browser inspection is untrusted content, possibly truncated. Each interaction
consumes a fresh document ID and inspected element reference. `browser.interact`
supports fill, select, bounded scrolling, and bounded key input. `attempted: true`
means only that the primitive ran; the capability driver must separately verify
the requested effect. No arbitrary JavaScript, selectors, credential inputs, or
filesystem paths are accepted by this interface.

Interactive actions may inherit the explicitly attached target. Saved routines
must persist target ID/revision, provider/version, and capability/version. Missing
or ambiguous account bindings require user intervention, not a guessed target.

`MistyCapabilityOutcomeSchema` requires explicit success data/evidence/partialness
or a typed failure, wait, or uncertain outcome. A missing result is never success.
An approval or device resume is another authorization attempt, not completion.

## Conformance requirements

`communications-capabilities.ts` exports the common Inbox and Social definitions.
Use these same semantic schemas for each provider. Their permissions describe
capabilities; a browser adapter also requires host-issued browser grants for the
specific target. A contract declaration never creates those grants.

Read results identify their source target and distinguish visible-page,
opened-thread and visited-search-page coverage. Drafts return a content hash and
recipients. Sends require that exact hash/recipient binding and return evidence of
provider acceptance or an observed sent item, never a guessed delivery status.

- Two providers can implement `inbox.read` without colliding.
- Browser availability never implies backend API authorization.
- A view closing invalidates its handles, not its durable account target.
- Account switching invalidates pending authority until the binding is confirmed.
- A sent message with a lost response is reconciled, never blindly sent again.
- Uninstall/revocation denies both discovery and already queued execution.
- A provider cannot grant itself authority through metadata or availability reports.
