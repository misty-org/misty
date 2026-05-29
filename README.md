# misty-scripts

Shared local build helpers for the projects in `misty-org`.

This directory is for local developer convenience only. These scripts are not
part of Misty's shipped runtime behavior, auto-update path, or background
process installation flow.

## Build everything

```bash
./misty-scripts/build.sh all
```

## Build individual targets

```bash
./misty-scripts/build.sh misty
./misty-scripts/build.sh proxy
./misty-scripts/build.sh hub
MISTY_RCLONE_SOURCE=/path/to/rclone ./misty-scripts/build.sh rclone
```

## Notes

- `misty` builds in `misty/build/release` by default.
- `misty-proxy` builds to `misty-proxy/dist/misty-proxy`.
- `misty-hub` runs `npm run build` and then `cargo build --manifest-path src-tauri/Cargo.toml`.
- `rclone` requires `MISTY_RCLONE_SOURCE`, which must point to a user-supplied
  local `rclone` checkout. The script does not fetch or modify `rclone`
  sources on its own, and installs the built binary to
  `~/.misty/rclone/rclone` by default.
