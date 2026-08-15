import type { DocPage } from "./types";
import { code, list, note, p, table } from "./types";

export const referencePages: DocPage[] = [
  {
    path: "/reference/command-index",
    title: "Command index",
    eyebrow: "Reference",
    description:
      "Every supported command, argument, option, and built-in shortcut in one place.",
    sections: [
      {
        id: "global",
        title: "Global",
        blocks: [
          table(
            ["Command or option", "Description"],
            [
              ["misty --help / -h", "Show top-level help."],
              ["misty --version / -V", "Show installed version."],
              [
                "--workspace <PATH>",
                "Override workspace discovery for the current command.",
              ],
              [
                "configure --workspace <PATH>",
                "Save a default workspace root.",
              ],
              ["doctor", "Validate the development and release environment."],
              ["check app", "Run desktop frontend and Rust checks."],
              [
                "check server",
                "Run Go, database, container, and Worker checks.",
              ],
              ["check all", "Run Misty checks followed by server checks."],
            ],
          ),
        ],
      },
      {
        id: "desktop",
        title: "Desktop",
        blocks: [
          table(
            ["Command", "Options"],
            [
              ["desktop dev", "--profile <NAME>, --route <PATH>"],
              ["desktop build", "None"],
              ["desktop clean", "--apply"],
              ["desktop icons sync", "--source <PATH>"],
              [
                "desktop windows stage-assets",
                "--source <PATH>, --destination <PATH>",
              ],
            ],
          ),
        ],
      },
      {
        id: "website",
        title: "Website",
        blocks: [table(["Command", "Options"], [["website dev", "None"]])],
      },
      {
        id: "server",
        title: "Server",
        blocks: [
          table(
            ["Command", "Options"],
            [
              ["server up", "--detach, --no-build"],
              ["server down", "--volumes"],
              ["server logs", "None"],
              ["server image build", "--tag <TAG> (required)"],
              [
                "server worker generate-secrets",
                "--target development|production",
              ],
              ["server worker deploy", "--target production, --dry-run"],
              ["server r2 configure-cors", "--apply"],
            ],
          ),
        ],
      },
      {
        id: "release",
        title: "Release",
        blocks: [
          table(
            ["Command", "Options"],
            [
              [
                "release start <VERSION>",
                "--dry-run, --no-macos, --no-windows",
              ],
              ["release build <VERSION>", "--dry-run"],
              ["release upload <VERSION>", "--dry-run"],
              ["release verify <VERSION>", "--dry-run"],
              ["release publish <VERSION>", "--yes, --dry-run"],
            ],
          ),
          note(
            "No hidden aliases",
            "The CLI intentionally exposes no abbreviated subcommands. The only short options are Clap’s built-in -h and -V. Use shell history, completion, or your own aliases for additional shortcuts.",
          ),
        ],
      },
      {
        id: "shell-shortcuts",
        title: "Optional shell shortcuts",
        blocks: [
          p(
            "These are convenience aliases you can add to ~/.zshrc. They are not part of misty and are deliberately easy to remove.",
          ),
          code(
            "alias mdev='misty desktop dev'\nalias msup='misty server up --detach'\nalias mslogs='misty server logs'\nalias msdown='misty server down'\nalias mcheck='misty check all'",
            "~/.zshrc",
          ),
          note(
            "No destructive alias",
            "Avoid aliasing server down --volumes, desktop clean --apply, R2 --apply, or release publish --yes. Keeping the dangerous words visible is a safety feature.",
            "warning",
          ),
        ],
      },
    ],
  },
  {
    path: "/reference/environment",
    title: "Environment variable reference",
    eyebrow: "Reference",
    description: "Every environment value read directly by misty.",
    sections: [
      {
        id: "all-variables",
        title: "Complete reference",
        blocks: [
          table(
            ["Name", "Required for", "Validation or default"],
            [
              [
                "MISTY_ROOT",
                "Workspace discovery",
                "Falls back to saved config, then ~/misty-org/misty.",
              ],
              [
                "MISTY_DESKTOP_DEV_PORT",
                "desktop dev, optional",
                "Unsigned port; defaults to 5173.",
              ],
              [
                "MISTY_DESKTOP_INITIAL_ROUTE",
                "desktop dev, optional",
                "Absolute in-app path.",
              ],
              [
                "MISTY_CODESIGN_IDENTITY",
                "Legacy macOS signing",
                "Copied only when APPLE_SIGNING_IDENTITY is absent.",
              ],
              [
                "APPLE_SIGNING_IDENTITY",
                "macOS release",
                "Non-empty signing identity.",
              ],
              [
                "MISTY_NOTARY_KEYCHAIN_PROFILE",
                "macOS release",
                "Non-empty notarytool Keychain profile.",
              ],
              [
                "TAURI_UPDATER_PUBLIC_KEY",
                "Release",
                "Generated Tauri public key or canonical base64 form.",
              ],
              [
                "TAURI_UPDATER_ENDPOINT",
                "Release",
                "HTTPS URL; no credentials or fragment.",
              ],
              [
                "TAURI_CSP_CONNECT_SOURCES",
                "Release",
                "HTTPS/WSS origins; no wildcard, path, query, credentials, fragment.",
              ],
              [
                "TAURI_CSP_IMAGE_SOURCES",
                "Release",
                "HTTPS origins with the same restrictions.",
              ],
              [
                "TAURI_SIGNING_PRIVATE_KEY",
                "Release",
                "Consumed by Tauri; presence reported by doctor.",
              ],
              [
                "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
                "Release",
                "Consumed by Tauri; presence reported by doctor.",
              ],
              [
                "WINDOWS_CERTIFICATE_THUMBPRINT",
                "Optional Windows signing",
                "Exactly 40 hexadecimal characters.",
              ],
              [
                "WINDOWS_TIMESTAMP_URL",
                "Windows signing",
                "Required with thumbprint; HTTPS URL.",
              ],
              ["R2_BUCKET", "R2 CORS", "Non-empty bucket name."],
              [
                "MISTY_R2_ALLOWED_ORIGINS",
                "R2 CORS",
                "Unique comma-separated approved origins.",
              ],
            ],
          ),
        ],
      },
      {
        id: "generated-profile-variables",
        title: "Variables set by the CLI",
        blocks: [
          p("desktop dev sets these only when --profile is present:"),
          table(
            ["Name", "Value"],
            [
              ["MISTY_PROFILE", "The profile name."],
              [
                "MISTY_DESKTOP_PROFILE",
                "The same profile name for desktop-specific consumers.",
              ],
              ["MISTY_PROFILE_DIR", "~/.misty/.profiles/<profile>."],
              [
                "MISTY_DESKTOP_DEV_PORT",
                "The selected available port, even when the starting value came from the environment.",
              ],
            ],
          ),
        ],
      },
      {
        id: "example",
        title: "Safe .env template",
        blocks: [
          code(
            "MISTY_ROOT=/Users/you/misty-org/misty\nTAURI_UPDATER_ENDPOINT=https://mistysys.com/latest.json\nTAURI_CSP_CONNECT_SOURCES=https://mistysys.com wss://mistysys.com\nTAURI_CSP_IMAGE_SOURCES=https://mistysys.com\nR2_BUCKET=misty-server\nMISTY_R2_ALLOWED_ORIGINS=https://mistysys.com,tauri://localhost",
            "cli/.env",
          ),
          note(
            "Illustrative only",
            "Add signing keys and real service origins from your secure configuration. Do not copy placeholder values into a release and never commit the populated file.",
          ),
        ],
      },
    ],
  },
  {
    path: "/reference/safety",
    title: "Safety model",
    eyebrow: "Reference",
    description:
      "Know which commands are read-only, locally destructive, remotely mutating, or public.",
    sections: [
      {
        id: "risk-table",
        title: "Command risk levels",
        blocks: [
          table(
            ["Level", "Commands", "Effect"],
            [
              [
                "Read-only / validation",
                "doctor, check, desktop clean, R2 configure-cors, release * --dry-run",
                "Inspect or validate; some dry runs write bounded local release state.",
              ],
              [
                "Local mutation",
                "configure, desktop build, desktop clean --apply, icons sync, Windows stage-assets, server up/down, image build, Worker secrets, release build",
                "Writes config/artifacts, starts services, or removes bounded local data.",
              ],
              [
                "Remote mutation",
                "R2 --apply, release start, release upload, release verify",
                "Changes Cloudflare or the GitHub draft release.",
              ],
              [
                "Public mutation",
                "release publish",
                "Makes the draft prerelease public.",
              ],
            ],
          ),
        ],
      },
      {
        id: "dangerous-options",
        title: "Explicit dangerous options",
        blocks: [
          list([
            "server down --volumes deletes persistent Compose volumes.",
            "desktop clean --apply removes generated local paths.",
            "server r2 configure-cors --apply replaces Cloudflare bucket CORS.",
            "release upload uses --clobber for same-named draft assets.",
            "release publish --yes bypasses the typed publication phrase.",
          ]),
        ],
      },
      {
        id: "secret-handling",
        title: "Secret handling",
        blocks: [
          list([
            "The ignored cli/.env is loaded without replacing exported shell values.",
            "Doctor reports only whether release inputs exist.",
            "Worker secret files use restricted permissions on Unix.",
            "The collaboration private key is written to the server secret file and never printed.",
            "GitHub authentication comes from gh auth rather than a custom token file.",
            "macOS notarization uses a named Apple Keychain profile.",
          ]),
        ],
      },
      {
        id: "release-guardrails",
        title: "Release guardrails",
        blocks: [
          list([
            "Semantic version syntax is validated.",
            "Application versions must match.",
            "release start requires clean, synchronized misty/main.",
            "Build and upload require exact source and CLI commits.",
            "The release configuration hash must stay constant.",
            "Artifacts are checked by size and SHA-256.",
            "Mac binaries must contain both architectures and pass signing/Gatekeeper checks.",
            "Publication re-runs verification.",
          ]),
        ],
      },
    ],
  },
  {
    path: "/reference/troubleshooting",
    title: "Troubleshooting",
    eyebrow: "Reference",
    description:
      "Resolve the most common development, Docker, Cloudflare, and release failures.",
    sections: [
      {
        id: "command-not-found",
        title: "misty is not found",
        blocks: [
          code(
            "cargo install --path ~/misty-org/misty/cli --locked --force\n~/.cargo/bin/misty --version",
          ),
          p(
            "If the absolute command works, add ~/.cargo/bin to your shell PATH and open a new terminal.",
          ),
        ],
      },
      {
        id: "workspace",
        title: "A checkout was not found",
        blocks: [
          code("misty configure --workspace ~/misty-org/misty\nmisty doctor"),
          p(
            "Confirm the workspace directly contains app/, website/, server/, and cli/. Use --workspace to diagnose another root without changing saved configuration.",
          ),
        ],
      },
      {
        id: "desktop-port",
        title: "Desktop development port is busy",
        blocks: [
          p(
            "The CLI automatically searches 50 ports beginning at 5173 or MISTY_DESKTOP_DEV_PORT. If all are occupied, choose another range:",
          ),
          code("MISTY_DESKTOP_DEV_PORT=6100 misty desktop dev"),
        ],
      },
      {
        id: "docker-health",
        title: "The API health check returns 503",
        blocks: [
          list([
            "Run misty server logs and find the first failing dependency, not just repeated /health entries.",
            "Confirm Docker Desktop is running and the database container is healthy.",
            "Check server/.env.dev because Compose, not the Go binary, supplies development server environment values.",
            "If the database schema is disposable and irreparably stale, stop with --volumes and recreate it—but only after accepting the data loss.",
          ]),
        ],
      },
      {
        id: "r2",
        title: "R2 CORS is rejected",
        blocks: [
          list([
            "Remove duplicate entries from MISTY_R2_ALLOWED_ORIGINS.",
            "Use an origin only: no path, query, credentials, or fragment.",
            "Use HTTPS outside approved localhost/Tauri development origins.",
            "Remove wildcard hosts.",
            "Run the dry run again before adding --apply.",
          ]),
        ],
      },
      {
        id: "release-identity",
        title: "Release identity mismatch",
        blocks: [
          p(
            "Do not work around an identity mismatch by editing a manifest. Check out the exact monorepo commit recorded in misty-release-manifest.json, ensure the working tree is clean, reinstall the matching CLI binary if needed, and retry.",
          ),
          note(
            "Why it fails closed",
            "Mixing revisions could make Mac and Windows artifacts behave differently while sharing one version. The refusal is the desired protection.",
            "warning",
          ),
        ],
      },
      {
        id: "release-inputs",
        title: "Release inputs are missing",
        blocks: [
          code("misty doctor"),
          p(
            "Doctor prints missing variable names. Add them to an ignored cli/.env or export them in the shell. It never prints their current values.",
          ),
        ],
      },
      {
        id: "macos",
        title: "macOS signing or notarization fails",
        blocks: [
          list([
            "Confirm APPLE_SIGNING_IDENTITY names an available Developer ID Application identity.",
            "Confirm MISTY_NOTARY_KEYCHAIN_PROFILE is a valid notarytool profile.",
            "Run doctor to verify xcodebuild, lipo, codesign, xcrun, and spctl.",
            "Verify both Rust Apple targets are installed.",
            "Do not upload artifacts until release build completes every signing, Gatekeeper, and stapler validation.",
          ]),
        ],
      },
      {
        id: "help",
        title: "Inspect the installed command surface",
        blocks: [
          code(
            "misty --help\nmisty desktop --help\nmisty server --help\nmisty release --help\nmisty release publish --help",
          ),
          p(
            "The documentation describes CLI v0.1.0. The installed --help output remains the final authority if the binary has moved ahead of these pages.",
          ),
        ],
      },
    ],
  },
];
