# Space chat Discord-layout design QA

## Evidence

- Source visual truth: `/var/folders/hd/3cy894z92v70m7crvhv8rwmr0000gn/T/TemporaryItems/NSIRD_screencaptureui_rfbQG9/Screenshot 2026-07-22 at 3.55.33 PM.png`
- Rendered implementation: `/Users/mtccool668/misty-org/misty/chat-discord-layout-implementation.png`
- Focused side-by-side comparison: `/Users/mtccool668/misty-org/misty/chat-discord-layout-comparison.png`
- First-pass implementation evidence: `/Users/mtccool668/misty-org/misty/chat-discord-layout-implementation-pass1.png`
- Source pixels: 1814 × 1588; density unknown.
- Implementation pixels/CSS viewport: 1280 × 900 at device scale factor 1.
- Focused comparison normalization: source scaled to 620 px wide and centered on a 640 × 600 field; implementation chat region cropped from x=360, y=28 at 920 × 844, scaled to 620 px wide, and centered on a 640 × 600 field. The two fields were combined into one 1280 × 600 image.
- State: dark desktop Space chat with two members, five realistic messages across two calendar dates, grouped consecutive messages, and an uploaded PNG avatar for Maya. Account settings also showed the uploaded avatar and `Change PNG` control.

## Full-view comparison

The Misty full view intentionally includes its app rail, Space navigation, and composer, while the Discord source is a chat-only crop. The main chat region preserves the source hierarchy: avatar gutter, sender and compact time metadata, unboxed message text, consecutive-message grouping, centered date rules, and rich-content space below message text.

## Focused comparison

The combined comparison makes the important chat details readable. Avatar size, sender/header alignment, compact follow-up rows, date-divider rhythm, and dark-surface contrast closely follow the source. The source contains a large video attachment and reply preview that are not present in the seeded implementation state; Misty's existing attachment and reply renderers remain intact, so this is a content-state difference rather than removed functionality.

## Findings

- No actionable P0, P1, or P2 visual differences remain.
- P3: Discord uses more varied sender-name colors in the reference. Misty keeps names on its existing foreground token to preserve product consistency and predictable contrast.
- P3: The source shows a denser conversation because it contains more messages and a large attachment. The seeded state is intentionally smaller so grouping and both date transitions remain inspectable.

## Required fidelity surfaces

- Fonts and typography: Misty's existing Inter typography is retained. Sender names use a compact semibold treatment, message copy is 15 px with 24 px line height, and timestamps are smaller tabular text. Message timestamps contain time only; calendar dates live in separators.
- Spacing and layout rhythm: 40 px round avatars appear on the first row of a sender group. Follow-up messages reuse the same 44 px gutter, group starts have additional vertical spacing, and date labels sit between full-width rules.
- Colors and visual tokens: Existing Misty background, foreground, muted, border, and hover tokens produce the same low-contrast dark hierarchy as the source without introducing Discord-specific hardcoded colors.
- Image quality and asset fidelity: Uploaded PNGs render through the existing Radix avatar image with cover cropping and a crisp circular mask. Initials remain as the no-image fallback; no placeholder bitmap was added to production code.
- Copy and content: Seeded chat copy is realistic collaboration content. UI labels are `Upload PNG`/`Change PNG`; message headers show sender, optional Agent/source badges, and time only.

## Interaction and runtime checks

- Opened the seeded authenticated Space chat in the in-app browser.
- Confirmed date separators for July 21 and July 22, 2026.
- Confirmed nearby same-sender messages render as compact follow-up rows.
- Opened Account settings and exercised the actual `Change PNG` file-chooser flow.
- Reloaded chat and confirmed the protected member avatar renders on historical messages.
- Checked browser console output; no app runtime errors remained in the final capture.

## Comparison history

1. First pass: the browser-only preview emitted a native `app_snapshot` notice over the first message, a P2 visual obstruction. The non-Tauri demo bootstrap was updated to skip native-only desktop initialization while retaining production behavior.
2. Post-fix pass: the notice disappeared, the authenticated chat loaded, profile PNGs rendered, and the final focused comparison showed no remaining P0/P1/P2 findings.

## Implementation checklist

- [x] Profile PNG upload with client and server validation.
- [x] Authenticated profile and Space-member avatar delivery.
- [x] Avatar rendering in Space chat with initials fallback.
- [x] Discord-style sender grouping and compact rows.
- [x] Time-only message metadata.
- [x] Date dividers between calendar days.
- [x] Targeted unit tests, server tests, and browser interaction checks.

## Reply-preview follow-up — July 22, 2026

### Evidence

- Source visual truth: `/var/folders/hd/3cy894z92v70m7crvhv8rwmr0000gn/T/TemporaryItems/NSIRD_screencaptureui_u2mgDm/Screenshot 2026-07-22 at 4.31.08 PM.png`
- Browser-rendered implementation: `/Users/mtccool668/misty-org/misty/.codex-reply-preview-refined-crop.png`
- Focused side-by-side comparison: `/Users/mtccool668/misty-org/misty/.codex-reply-comparison-refined.png`
- Source pixels: 688 × 360 at an inferred 2× desktop capture density.
- Implementation viewport: 344 × 230 CSS px at device scale factor 1; the comparable 344 × 180 reply region was captured from the browser.
- Density normalization: the source was downsampled to 344 × 180 before comparison. The implementation uses the same CSS-sized field. Horizontal translation from the source's arbitrary crop was ignored; avatar, rail, and content relationships were compared relative to one another.
- State: dark Space chat with a reply to a person, a referenced image attachment, the reply sender header, and three same-sender compact follow-up messages.

### Full-view and focused comparison

The browser-rendered reply preserves the reference hierarchy: a compact one-line source preview above the reply, an elbow rail anchored to the replying message's avatar gutter, a small source avatar, `@name`, message excerpt, image indicator, then the new sender header and message. The focused comparison was required because the reference itself is a cropped chat fragment; it shows the avatar-to-content rhythm, connector geometry, and vertical grouping clearly.

### Findings and required fidelity surfaces

- No actionable P0, P1, or P2 differences remain.
- Fonts and typography: reply context is 13 px with semibold identity text; sender headers are 15 px semibold; message text remains 15 px/24 px. The one-line source excerpt truncates safely at narrow widths.
- Spacing and layout rhythm: the final pass uses a 20 px avatar-to-content gap consistently in the reply preview and message rows. The 37 px rail reaches from the replying avatar column to the source preview without colliding with its avatar.
- Colors and visual tokens: the rail uses the muted foreground token and the preview uses Misty's foreground/primary tokens. Discord role colors were not copied because Misty does not currently store an equivalent per-member chat color.
- Image quality and asset fidelity: production member avatars remain real uploaded PNGs with initials fallback. The reference's image cue is represented with the existing icon library and a foreground tile; no placeholder bitmap or handcrafted SVG was added.
- Copy and content: the preview derives from the actual referenced message, flattens line breaks for one-line display, preserves mentions, and falls back to `Original message unavailable` when necessary.

### Interaction and runtime checks

- Rendered the production `SpaceChatMessages` component with a realistic reply state in the in-app browser.
- Activated the unique `Jump to Souls's message` control and confirmed it retained the chat state.
- Checked browser warnings and errors; none were present.
- TypeScript, Prettier, and the targeted four-test Space chat suite passed.

### Comparison history

1. First pass: the reply rail and ordering matched, but the 12 px avatar-to-content gap was visibly tighter than the source and the image cue lacked the source's filled tile treatment (P2).
2. Final pass: widened both message and reply grids to 20 px, tuned the rail length, strengthened reply-preview typography, and added the filled image cue. The normalized comparison showed consistent relative alignment with no remaining P0/P1/P2 findings.

final result: passed
