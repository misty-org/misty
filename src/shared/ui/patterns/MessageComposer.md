# Shared message composer

Import `MessageComposer`, `MessageComposerSend`, and `messageComposerTextClass` from `@/shared/ui`. [MessageComposer.tsx](MessageComposer.tsx) owns the monochrome frame, textarea, automatic height, and control-row geometry used by Spaces chat, Agents conversations, Global Misty, and agent execution follow-ups.

## Usage contract

- Pass the controlled value, change handler, accessible label, disabled state, and keyboard handlers through `inputProps`. Use `inputRef` for focus, selection, or scroll synchronization; the forwarded component ref points to the outer frame.
- Put attachment/upload controls in `leading` and send, stop, mention, emoji, or other feature actions in `actions`. Use `MessageComposerSend` for the shared ArrowUp send affordance; provide its accessible `label`, handler or button type, and disabled/busy state. A running agent can supply its existing Stop action instead.
- Put reply banners and attachment previews in `context`, above the input row. Use `footer` for supporting controls or status; it wraps within the frame.
- Use `overlay` for a visual text layer inside the textarea's relative container. Mention overlays must share `messageComposerTextClass`, remain noninteractive and `aria-hidden`, and synchronize scrolling in the adapter so text and highlights stay aligned.
- Keep drafts, uploads, permissions, mention selection, recording, send/retry logic, and keyboard submission in feature adapters. The shared component neither submits nor persists anything. Adapters retain Enter/Shift+Enter behavior and IME guards.

The textarea grows from 38px to 160px and recalculates on controlled-value and width changes. The empty input row measures 52px including padding and border. Text uses a 22px line height, 14px desktop size, and 16px below the `md` breakpoint. Share these dimensions rather than adding feature-specific textarea or frame overrides. Parent surfaces own placement and outer margins.

Current adapters are `MistyComposer` (Agents and Global Misty), `SpaceChatComposer`, and `AgentExecutionSurface`. See the [Spaces integration record](../../../../docs/design/spaces-chat/INTEGRATION.md) for the current visual evidence and its verification limits.
