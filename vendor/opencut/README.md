# OpenCut, vendored

The video editor on a Space's Media page is OpenCut's web editor, from
[opencut-app/opencut-classic](https://github.com/opencut-app/opencut-classic) (MIT, see `LICENSE`),
at the commit in `UPSTREAM`. `src/` is its `apps/web/src`; `public/` holds the assets the editor
loads (the font atlas, flag stickers, the effect preview). Misty mounts it from
`src/features/files/video-editor`.

The editor's logic is kept as upstream wrote it, so it can be compared with and updated from
OpenCut. Misty's own changes say so in a `Misty:` comment. In short:

- Left out: the Next.js app (`app/`), the landing page, blog, changelog, auth, database, feedback,
  site, env and Whisper worker, and OpenCut's header, onboarding and mobile gate (Misty draws its
  own bar).
- Imports use `@opencut/` in place of `@/`, which is Misty's.
- `components/ui/` is no longer OpenCut's shadcn kit: each file draws the part with Misty's
  `src/shared/ui` (Button, Popover, Dialog, Select, Tooltip, Tabs and the rest).
- `components/icons/huge.tsx` stands in for Hugeicons: each icon OpenCut names is the Lucide icon
  of the same subject. `components/toast.ts` stands in for `sonner` (Misty's notices) and
  `components/next-image.tsx` for Next's Image.
- Color class names carry an `oc-` prefix (`bg-oc-background`, `text-oc-muted-foreground`), and
  `opencut-theme.css` points each at Misty's theme.
- `wasm/load.ts` loads OpenCut's Rust core (the `opencut-wasm` package) once before the editor's
  modules load; Vite resolves `opencut-wasm` to it.
- `assets.ts` serves the files in `public/` through the bundle, since Misty's window has no public
  folder.
- `services/transcription/service.ts` transcribes with the computer's own speech recognition,
  through a transcriber Misty sets, in place of Whisper.
- `components/editor/editor-layout.tsx` is OpenCut's editor page layout as a component.
- `components/editor/export-button.tsx` can save an export to a destination (Media) besides a
  download.
- `look/` adds what OpenCut left as placeholders: color adjustments (`adjust.ts`, applied on the
  GPU by `color-pass.ts` as frames go to the compositor) and transitions (`transitions.ts`,
  applied in `services/renderer/resolve.ts`), both as element params, with the Adjustment and
  Transitions rail tabs and properties tabs.
- `media/space-media.ts` gives the Media tab ("Import › From Media") and the Sounds tab
  (`sounds/components/space-sounds-view.tsx`, in place of OpenCut's Freesound search) the Space
  the editor was opened from. A sound's ⋯ menu there also adds it as music and cuts the video
  to its beat, through `sounds/music-tools.ts`, which Misty sets
  (`src/features/files/video-editor/editorMusic.ts`).
- `transcription/group-words.ts` turns the speech recognizer's timed words into caption phrases,
  each keeping its words' times.
- Caption styles (`subtitles/caption-style.ts`: plain, serif, bold, karaoke), chosen on the
  Captions tab for new captions and, as one undo step, the ones on the timeline
  (`subtitles/restyle.ts`). Text takes an outline (`text/stroke.ts`), and a karaoke caption
  lights its words as they're said (`text/karaoke.ts`, from the `caption.words` param); both are
  element params drawn by `text/primitives.ts`, with the karaoke moment worked out in
  `services/renderer/resolve.ts`, so the preview and the export match.
- `motion/` adds motion graphics: a graphic (`definitionId: "motion"`) whose params hold a
  `draw(ctx, t, props)` script and its props. The script runs in QuickJS compiled to
  WebAssembly (`runtime.ts`) against a context that only records calls (`prelude.ts`); the
  calls are checked and replayed on the canvas (`commands.ts`). The graphic node draws it at the
  canvas's size for each moment, and `services/renderer/resolve.ts` loads the engine before the
  first frame. Its properties tab shows the props and the script, and the Text tab has starter
  graphics (`presets.ts`).
- `timeline/footage-marks.ts` and `commands/scene/add-bookmarks.ts`: a clip's "Mark the beat" and
  "Mark the shots", bookmarks from Misty's footage analysis, set while Misty's editor is open.
- Misty's interface rules: no spinner in the Generate captions button, a sheet that doesn't dim
  the editor, icon-only buttons named by their tooltip.
- Fixed upstream type errors: the storage migrations' adapter calls, the sticker registry call,
  and a keybinding persistence module nothing imported (removed).

These files are third-party code: Misty's architecture and style rules for `src/` don't apply
here.
