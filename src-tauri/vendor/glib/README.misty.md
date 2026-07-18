# GLib security backport

This is the source and test code from the crates.io `glib` 0.18.5 release,
licensed under the upstream MIT license in `LICENSE`.

Tauri's GTK3 dependency graph requires GLib 0.18, so upgrading this crate alone
to 0.20 would introduce incompatible GTK types. The desktop manifest instead
patches crates.io to use this copy with the upstream fix for
[RUSTSEC-2024-0429 / GHSA-wrw7-89jp-8q8g](https://rustsec.org/advisories/RUSTSEC-2024-0429.html).

The only Rust source change is in `src/variant_iter.rs`: `VariantStrIter::impl_get`
passes a mutable pointer to the variadic C function's output argument, matching
[gtk-rs/gtk-rs-core#1343](https://github.com/gtk-rs/gtk-rs-core/pull/1343).
The upstream version number is preserved; this is a local patched dependency,
not a new upstream release.

On a system with the GLib development libraries installed, run the upstream
iterator tests with optimization, where the original bug caused crashes:

```sh
cargo test --manifest-path src-tauri/vendor/glib/Cargo.toml --release variant_iter
```

Remove this patch when Tauri's GTK dependency graph supports a fixed upstream
GLib release (0.20 or later).
