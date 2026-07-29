# Desktop beta release policy

Misty desktop releases use semantic versions shared by `package.json`,
`src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.

## Channels and tags

- Public beta releases use `0.x.y` versions and `misty-v0.x.y` Git tags.
- The tag must point to a commit on the protected release branch with green CI.
- The signed release workflow repeats the release gate, builds Apple Silicon,
  Intel macOS, and Windows x64 artifacts, and creates a draft GitHub prerelease.
- Draft releases are never visible to the updater. The owner publishes a draft
  only after macOS notarization, Authenticode, checksums, `latest.json`, and the
  packaged acceptance smoke tests have been reviewed.
- Stable `1.x.y` promotion is a separate owner decision after the beta exit
  criteria are met. Beta clients never accept downgrades.

## Version changes

- Patch: fixes with no intended data-format or API incompatibility.
- Minor: user-visible capability or compatible schema/API addition.
- Major: compatibility break, requiring an explicit migration and rollback
  plan.

Update all three version files in one pull request. The tag workflow fails if
any version differs from the tag.

## Release notes

Every release describes:

- user-visible changes and fixed data-loss/security defects
- migration or compatibility notes
- known limitations and recovery guidance
- support contact and affected platforms

Generated GitHub notes are a starting point and must be edited before the draft
is published. Never include secrets, internal identifiers, user content, or
unredacted incident details.

## Promotion and rollback

1. Promote the exact tested commit and immutable artifacts; do not rebuild.
2. Publish the draft only after both platform signatures and update metadata
   have been verified.
3. Pause the updater by returning `204 No Content` or withdrawing the release
   if a defect is found.
4. Tauri does not permit an unsigned update or downgrade. Ship a higher
   forward-fix version; direct reinstall of a previous signed version is an
   owner-assisted recovery path and must preserve user data.
