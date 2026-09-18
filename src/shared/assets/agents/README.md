# Agent cloud avatars

Generated on 2026-09-18 from Misty's existing `../misty-cloud-expression-cycle.webp` using the built-in image-generation tool. All four UI presets use transparent, animated WebPs. The original blue animation remains unchanged.

- `cloud-lavender.webp`: lavender rim, alternating open eyes and a playful wink.
- `cloud-mint.webp`: mint rim, alternating focused eyes and a peaceful blink.
- `cloud-peach.webp`: peach rim, alternating joyful curved eyes and open eyes.

Each animation has a 512 × 512 transparent canvas and five lossless frames, looping indefinitely with the original's 1200 / 650 / 850 / 1150 / 900 ms timing (4.75 seconds). The new variants alternate between two expression keyframes. `cloud-*-poster.webp` files provide static first frames for reduced-motion settings through the shared picture component.

The base PNGs and `source/*-alternate.png` files are editable source keyframes, not runtime imports. Regenerate the WebPs with `node cli/tasks/build-agent-cloud-webps.ts`; this requires `cwebp`, `webpmux`, and `ffmpeg` on PATH.

The edit brief preserved the original silhouette, rounded lobes, face placement, white inner outline, and soft sticker shading. No text, props, background, or external shadow. Keep the native alpha when reusing these assets.

`agentCloudAvatars.ts` defines the UI presets. Agent profiles persist the selected ID in `avatar.cloudVariant`; explicit custom emojis are supported separately.
