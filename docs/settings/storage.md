# Settings

Misty is a desktop application. Settings belong to the device: they are saved in `misty.db` (`~/.misty/.local/data/misty.db`), apply to everyone who uses the app on it, and never leave it. Nothing in the settings system talks to the server. The account website is a separate administration surface; the desktop app opens it through the configured website helper.

Controls that are the server's own resources (a conversation's retention, whether hosted Misty is on, the model catalog) are not settings in this sense: they have their own server APIs and are not stored here.

## Declaring and resolving a setting

`src/features/settings/devicePreferences/definitions.json` declares stable keys, value types, defaults, validation constraints, desktop availability, and search labels. `registry.ts` adapts values for runtime consumers. A setting resolves to the value this device saved, else its built-in default. There are no profile selectors and no per-account copies.

## Persistence

The native commands `settings_profile_state` and `settings_profile_commit` read and write the saved values in the `settings_state` table, with a compare-and-swap revision so two windows cannot overwrite each other. A second table, `settings_document`, holds the sections-and-keys document the native code reads. Changes reach runtime adapters after the local commit. The renderer has no alternate IndexedDB settings backend.

An earlier build's `config/settings.json` is imported once. States saved by earlier builds (a copy of a server record plus queued edits) are converted into this device's values on first read.

## Verification

Frontend tests cover registered keys, migration from every earlier state shape, edits and resets, restart persistence, and storage failures. Native tests cover the revision check, scope isolation, normalization, and the one-time file import.
