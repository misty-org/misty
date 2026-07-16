# Misty storage service

Misty embeds a patched, narrowly configured rclone C library. The official
rclone source lives in the `rclone` submodule; Misty's product integration is
kept as reviewable patches in `patches/`.

Initialize the source after cloning:

```sh
git submodule update --init --recursive
```

Build the host library with `npm run service:archive`. The build script copies
the pinned submodule into the ignored Tauri target directory, applies the patch
series there, and never modifies the submodule checkout.

See `MISTY_PROVENANCE.md` before changing the upstream revision or patch set.
