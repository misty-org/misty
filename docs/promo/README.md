# Misty feature walkthrough

90 seconds · 1920 × 1080 · 30 fps · monochrome · no voiceover.

The film follows the synthetic **Website launch** project through Browser, personal and shared Spaces, Files, Agents, and sequential session handoff. On-screen copy uses literal feature names and actions.

## Deliverables

- `output/misty-promo.mp4` — final H.264 video, original stereo score and interaction sounds, chapter markers.
- `output/misty-silent.mp4` — identical animation without an audio stream.
- `output/storyboard.png` — eight-scene contact sheet.
- `output/scene-*.png` — full-resolution storyboard frames.
- `output/misty-rough.mp4` — intermediate 960 × 540, 10 fps rough cut; retained as a production artifact, not the final video.
- `output/review-frames.png` — action and transition samples for visual review.
- `output/soundtrack.wav` — original, unnormalized score and effects source, 48 kHz stereo.
- `output/verification.json` — deterministic rendering, scene-content, preview-control, and final media checks.

Outputs, render caches, and built preview files are ignored by Git. Editable source lives in this directory. No application source was modified for the promo.

## Preview and edit

From the repository root:

```sh
node node_modules/vite/bin/vite.js --config docs/promo/vite.config.mjs
```

Open `http://127.0.0.1:5290/`. The preview is silent and does not autoplay. Play/pause with the button or Space; use the timeline or scene selector to inspect a moment. The preview fits a narrow window; the encoded master stays widescreen. Reduced-motion mode suppresses camera movement and the cursor in the preview.

- `main.tsx`: staged interfaces, project content, actions, camera, cursor, preview controls.
- `timeline.ts`: scene boundaries, duration, frame rate, sample times, and click cues.
- `promo.css`: composition and Misty’s monochrome theme.
- `scripts/audio.py`: original procedural music and interaction sounds; fixed random seed.
- `scripts/render.mjs`: storyboard, rough, and final frame rendering.
- `scripts/mix.mjs`: soundtrack normalization, chapter metadata, and final MP4 assembly.

Rendering uses `window.renderFrame(frame)` and React’s synchronous commit. It does not depend on wall-clock animation, CSS transition progress, network data, or random app state. The same frame renders identically after arbitrary seeks. Scrubbing is not a live account operation.

## Render

Use the repository’s existing Node dependencies for React, Vite, Tailwind, Lucide, and Inter. Renderer dependencies are Playwright and Sharp. The scripts resolve them from this project first, then the local Codex dependency bundle. Chromium and FFmpeg must be available. `CHROMIUM_PATH` and `FFMPEG` can override their executables. Python requires NumPy; the bundled Codex Python includes it.

With the preview server running:

```sh
node docs/promo/scripts/render.mjs storyboard
node docs/promo/scripts/render.mjs rough
node docs/promo/scripts/render.mjs final
python3 docs/promo/scripts/audio.py
node docs/promo/scripts/mix.mjs
node docs/promo/scripts/verify.mjs
```

If the system Python lacks NumPy, use the bundled Python executable returned by Codex’s workspace dependency tool, or an existing Python environment with NumPy. No application dependency or lockfile changes are required.

`RENDER_WORKERS=3` is the default. Render workers each encode contiguous frames, then concatenate the segments without re-encoding. `PROMO_URL` changes the renderer’s preview origin. The final video uses H.264, CRF 18, 4:2:0 pixel format, AAC stereo at 256 kbps, and MP4 fast-start metadata. The soundtrack target is approximately −20 LUFS with a −2 dBTP ceiling. If the composition changes, update the measured loudness values in `mix.mjs` using FFmpeg’s `loudnorm` analysis pass.

Build the portable preview:

```sh
node node_modules/vite/bin/vite.js build --config docs/promo/vite.config.mjs
```

Serve `docs/promo/dist` with a static HTTP server. That built preview includes its own fonts, branding, and runtime, without a backend.

## Storyboard

| Time  | Scene         | Demonstration                                                                                                           |
| ----- | ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 0–7   | Introduction  | Misty branding, then the browser and project research.                                                                  |
| 7–17  | Browser       | Address entry, tab switching, context-menu grouping.                                                                    |
| 17–30 | Spaces        | Personal collection, launch brief, tasks, reference library.                                                            |
| 30–42 | Shared spaces | Team conversation, shared-note edit, task assignment.                                                                   |
| 42–54 | Files         | Select a paired computer, preview a file, copy it over the local network.                                               |
| 54–66 | Agents        | Supply the brief, submit a task, show a generated release checklist.                                                    |
| 66–84 | Session sync  | Save the desktop workspace; on the laptop, open it and restore the matching tabs and page position; continue scrolling. |
| 84–90 | Close         | Misty logo and “Try the beta.”                                                                                          |

## Visual sources and product boundaries

This is an **animated reconstruction using staged data**, not a screen recording or an end-to-end run against live accounts. The film reuses Misty’s actual `Button` and `Avatar` primitives, branding asset, Lucide icons, and monochrome theme values. The surrounding shell and feature surfaces are render-specific compositions based on the current source; they do not mount the complete production application. Research page content, conversations, files, transfers, and agent output are synthetic.

Incumbent references inspected:

- `src/styles/styles.css` and `src/app/layouts/DesktopLayout/DESIGN.md`: theme, rail geometry, tabs, and global navigation.
- `docs/design/spaces-chat/README.md` and the Space rail, message-row, and collection source: personal/shared work, conversations, notes, tasks, and Library.
- `src/features/files/README.md`: local drives, OS-mounted shares, and paired-device LAN access. The film does not depict internet file relays or cloud-storage connectors.
- `src/features/browser-workspace/SyncDeviceList.tsx` and `restore/`: the current exclusive workspace claim, capture-before-switch, supported page restoration, and partial-state handling. Handoff is sequential; it does not promise concurrent control or perfect restoration of arbitrary sites. Tab-group metadata is not claimed as part of handoff.
- `src/features/browser-workspace/WebsiteDataCoverage.tsx`: website-data coverage can be partial. The literal “Supported website sign-ins” label preserves that qualification.
- `server/apps/agent-runtime/README.md`: agent task execution and scoped application tools. The film demonstrates a staged brief-to-checklist result, not live agent latency.

Animations compress time for presentation. No speed, memory, latency, or comparative performance numbers appear. The only transfer numbers describe the synthetic example file. No external media, stock tracks, user account content, or third-party recordings are included. Existing Inter and Lucide licenses continue to apply to those bundled dependencies.

## Validation

- Isolated TypeScript check and Vite production build.
- Exact screenshot-hash comparison after seeking away and returning to a frame.
- Content assertions across 16 action/result timestamps; preview play/pause, scene selection, and narrow-window fit.
- Eight storyboard frames and 22 action/transition samples inspected in a batched visual pass, with one corrective pass.
- Final media checks: 2,700 frames, 1920 × 1080, 30 fps, 90 seconds, YUV 4:2:0; stereo 48 kHz audio in the final and no audio in the silent version.
- Mechanical design scan only flagged retained Inter typography, intentionally inherited from the app’s existing preview system.

These checks validate the animation and exported media. They do not certify live multi-device sync, file transfer, or agent service behavior.
