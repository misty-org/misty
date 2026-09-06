# Official app releases

All ten desktop apps use signed downloadable components. Supported mobile apps remain embedded; mobile packaging is outside this beta.

Follow [the macOS beta release pipeline](macos-beta.md) to prepare immutable packages, installers, checksums, and draft releases. Preparation works from PR branches. Promotion is explicit and publishes the already prepared bytes, with the Go catalog compatibility check before updating feeds. App tags no longer publish immediately.
