import type { DocPage } from "./types";
import { code, list, note, p, table } from "./types";

export const desktopPages: DocPage[] = [
  {
    path: "/desktop",
    title: "Desktop commands",
    eyebrow: "Desktop",
    description:
      "Develop, build, clean, and prepare the Misty Tauri application.",
    sections: [
      {
        id: "commands",
        title: "Available commands",
        blocks: [
          table(
            ["Command", "Purpose"],
            [
              [
                "desktop dev",
                "Start Vite and the native Tauri development application.",
              ],
              [
                "desktop build",
                "Create a native Tauri build for the current platform.",
              ],
              ["desktop clean", "Preview or remove bounded generated files."],
              [
                "desktop icons sync",
                "Regenerate platform icons from the canonical ICNS.",
              ],
              [
                "desktop windows stage-assets",
                "Copy local Misty assets into a Windows test directory.",
              ],
            ],
          ),
        ],
      },
      {
        id: "development-loop",
        title: "Recommended loop",
        blocks: [
          code(
            "misty server up --detach\nmisty desktop dev --profile owner\n\n# Before pushing\nmisty check app",
          ),
        ],
      },
    ],
  },
  {
    path: "/desktop/dev",
    title: "misty desktop dev",
    eyebrow: "Desktop",
    description:
      "Run the desktop app with an available Vite port, optional isolated profile, and optional initial route.",
    command: "misty desktop dev [--profile <NAME>] [--route <PATH>]",
    sections: [
      {
        id: "options",
        title: "Options",
        blocks: [
          table(
            ["Option", "Default", "Description"],
            [
              [
                "--profile <NAME>",
                "None",
                "Creates a separate app identity and data directory.",
              ],
              [
                "--route <PATH>",
                "Environment or empty",
                "Initial absolute in-app route such as /spaces.",
              ],
              ["MISTY_DESKTOP_DEV_PORT", "5173", "First local port to test."],
              [
                "MISTY_DESKTOP_INITIAL_ROUTE",
                "Empty",
                "Route fallback when --route is omitted.",
              ],
            ],
          ),
        ],
      },
      {
        id: "examples",
        title: "Examples",
        blocks: [
          code(
            "# Standard development\nmisty desktop dev\n\n# Open a specific screen\nmisty desktop dev --route /spaces\n\n# Isolated identity and local data\nmisty desktop dev --profile owner\n\n# Combine both\nmisty desktop dev --profile testing --route /settings",
          ),
        ],
      },
      {
        id: "behind-the-scenes",
        title: "What happens",
        blocks: [
          list([
            "The CLI starts at MISTY_DESKTOP_DEV_PORT or 5173 and probes up to 50 consecutive localhost ports.",
            "A temporary Tauri config points devUrl at http://127.0.0.1:<port><route>.",
            "Tauri runs npm run dev:desktop as its beforeDevCommand.",
            "The CLI runs npm run tauri -- dev --config <temporary-config> from the monorepo.",
            "The temporary configuration is deleted after the process exits.",
          ]),
        ],
      },
      {
        id: "profiles",
        title: "Development profiles",
        blocks: [
          p(
            "A profile is useful for testing multiple accounts or app identities without sharing one local Misty data directory. It changes the development product name and Tauri identifier.",
          ),
          table(
            ["Value", "Result"],
            [
              ["Product name", "Misty <profile>"],
              ["Tauri identifier", "com.misty.desktop.<profile>"],
              ["Profile directory", "~/.misty/.profiles/<profile>"],
              [
                "Process environment",
                "MISTY_PROFILE, MISTY_DESKTOP_PROFILE, MISTY_PROFILE_DIR",
              ],
            ],
          ),
          note(
            "Profile syntax",
            "Use 1–32 lowercase letters, numbers, or hyphens. The first character must be a letter or number. owner-2 is valid; Owner, ../owner, and owner_test are rejected.",
          ),
        ],
      },
      {
        id: "routes",
        title: "Route validation",
        blocks: [
          list([
            "Routes must begin with one slash, for example /spaces/demo.",
            "Protocol-relative values beginning with // are rejected.",
            "URLs containing :// are rejected.",
            "--route takes precedence over MISTY_DESKTOP_INITIAL_ROUTE.",
          ]),
          note(
            "This is an in-app route",
            "Pass a Misty route, not an external website URL. The route is appended to the local Vite dev URL.",
            "warning",
          ),
        ],
      },
    ],
  },
  {
    path: "/desktop/build",
    title: "misty desktop build",
    eyebrow: "Desktop",
    description:
      "Create a normal native Tauri build for the operating system you are currently using.",
    command: "misty desktop build",
    sections: [
      {
        id: "usage",
        title: "Usage",
        blocks: [
          code("misty desktop build"),
          p(
            "The CLI runs npm run tauri -- build in the monorepo. Tauri uses the repository’s normal configuration and produces native output under src-tauri/target.",
          ),
        ],
      },
      {
        id: "build-vs-release",
        title: "Build versus release build",
        blocks: [
          table(
            ["Command", "Use it for"],
            [
              [
                "desktop build",
                "A normal local native build with the checked-in Tauri configuration.",
              ],
              [
                "release build VERSION",
                "Identity-locked shipping artifacts, updater signatures, metadata, and platform validation.",
              ],
            ],
          ),
          note(
            "Not a production release",
            "desktop build does not create a release manifest, verify source identity, upload artifacts, or publish anything.",
            "info",
          ),
        ],
      },
    ],
  },
  {
    path: "/desktop/clean",
    title: "misty desktop clean",
    eyebrow: "Desktop",
    description:
      "Preview or remove known generated files without touching source, environment, or signing material.",
    command: "misty desktop clean [--apply]",
    sections: [
      {
        id: "dry-run",
        title: "Dry-run by default",
        blocks: [
          code("misty desktop clean"),
          p(
            "Without --apply, the command prints every existing candidate as “would remove” and finishes with instructions to opt in. Nothing is deleted.",
          ),
        ],
      },
      {
        id: "apply",
        title: "Apply cleanup",
        blocks: [
          code("misty desktop clean --apply"),
          note(
            "Destructive but bounded",
            "--apply permanently removes the listed generated files. Review the dry-run output first.",
            "warning",
          ),
        ],
      },
      {
        id: "paths",
        title: "Generated paths",
        blocks: [
          list([
            "dist, build, .vite, and node_modules/.vite.",
            "design-qa, design-qa-output, and artifacts/design-qa.",
            "src-tauri/target.",
            "Apple generated build, DerivedData, Externals, and Pods directories.",
            "Android .gradle and nested build directories.",
            ".DS_Store files outside ignored .git, node_modules, and target trees.",
          ]),
        ],
      },
      {
        id: "guardrails",
        title: "Cleanup guardrails",
        blocks: [
          list([
            "The repository root itself is always rejected.",
            "The complete node_modules directory is never selected.",
            "Any path containing .env is rejected.",
            "Any path containing signing, case-insensitively, is rejected.",
            "A candidate that escapes the misty repository is rejected.",
            "Symlinks are not followed while discovering files.",
          ]),
        ],
      },
    ],
  },
  {
    path: "/desktop/icons",
    title: "misty desktop icons sync",
    eyebrow: "Desktop",
    description:
      "Regenerate Tauri’s platform icon set from the canonical Misty ICNS file.",
    command: "misty desktop icons sync [--source <PATH>]",
    sections: [
      {
        id: "usage",
        title: "Usage",
        blocks: [
          code(
            "# Use the canonical local asset\nmisty desktop icons sync\n\n# Use another ICNS source\nmisty desktop icons sync --source /path/to/misty-logo.icns",
          ),
          table(
            ["Option", "Default", "Description"],
            [
              [
                "--source <PATH>",
                "~/.misty/assets/icons/misty-logo.icns",
                "Source ICNS containing PNG variants.",
              ],
            ],
          ),
        ],
      },
      {
        id: "process",
        title: "What happens",
        blocks: [
          list([
            "The command validates the ICNS header.",
            "It selects the largest supported embedded PNG variant.",
            "The local Tauri binary generates the platform icon set.",
            "The source ICNS is copied to app/src-tauri/icons/icon.icns.",
          ]),
          note(
            "Install dependencies first",
            "Icon synchronization uses the app workspace’s Tauri npm script. Run npm install at the monorepo root if dependencies are missing.",
          ),
        ],
      },
    ],
  },
  {
    path: "/desktop/windows",
    title: "misty desktop windows stage-assets",
    eyebrow: "Desktop",
    description:
      "Copy local Misty assets into a Windows-friendly test destination.",
    command:
      "misty desktop windows stage-assets [--source <PATH>] [--destination <PATH>]",
    sections: [
      {
        id: "options",
        title: "Options",
        blocks: [
          table(
            ["Option", "Default", "Description"],
            [
              ["--source <PATH>", "~/.misty/assets", "Asset tree to copy."],
              [
                "--destination <PATH>",
                "misty/.windows-test/.misty/assets",
                "Staging directory.",
              ],
            ],
          ),
          code(
            "misty desktop windows stage-assets\nmisty desktop windows stage-assets \\\n  --source D:\\MistyAssets \\\n  --destination D:\\MistyTest\\.misty\\assets",
          ),
        ],
      },
      {
        id: "copy-behavior",
        title: "Copy behavior",
        blocks: [
          list([
            "The source must exist and be a directory.",
            "An existing destination is cleared before copying.",
            ".DS_Store, Thumbs.db, and desktop.ini are omitted.",
            "Directories are recreated and regular files are copied recursively.",
            "If source and destination are the same path, nothing is rewritten.",
            "The final message reports the number of asset files staged.",
          ]),
          note(
            "Destination replacement",
            "A custom destination is deleted and recreated when it already exists. Point it only at a disposable staging directory.",
            "warning",
          ),
        ],
      },
    ],
  },
];
