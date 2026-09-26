# Library

This directory contains Misty's built-in Space Library collections and shared resources, including colocated tests. Its component entry and workspace code compile into Misty; they have no separate installation or update lifecycle.

From the repository root, run `misty desktop dev` for development or `npm run build:desktop` to build the frontend. Run `misty check tools` for the built-in tool tests.

Shared UI, API adapters, native services, and SDK interfaces come from this workspace and its root lockfile. See [Built-in Misty tools](../../../docs/builtin-tools.md) for the shared build and native-worker lifecycle.
