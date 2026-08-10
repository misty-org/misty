import type { DocPage } from "./types";
import { code, list, note, p, table } from "./types";

export const workspacePages: DocPage[] = [
  {
    path: "/configure",
    title: "misty-cli configure",
    eyebrow: "Workspace",
    description:
      "Save the root directory containing the Misty application, server, and CLI checkouts.",
    command: "misty-cli configure --workspace <PATH>",
    sections: [
      {
        id: "usage",
        title: "Usage",
        blocks: [
          code("misty-cli configure --workspace ~/misty-org"),
          table(
            ["Option", "Required", "Description"],
            [
              [
                "--workspace <PATH>",
                "Yes",
                "Directory containing misty, misty-server, and misty-cli.",
              ],
            ],
          ),
          p(
            "The command creates the platform configuration directory when needed and writes config.toml. It prints the saved file path after success.",
          ),
        ],
      },
      {
        id: "resolution",
        title: "Workspace resolution order",
        blocks: [
          table(
            ["Priority", "Source", "Example"],
            [
              ["1", "Command option", "--workspace /Volumes/code/misty-org"],
              [
                "2",
                "Shell environment",
                "MISTY_ORG_ROOT=/Volumes/code/misty-org",
              ],
              ["3", "Saved configuration", "config.toml written by configure"],
              ["4", "Default", "~/misty-org"],
            ],
          ),
          note(
            "Temporary overrides",
            "Use --workspace when you only want to target another checkout once. configure changes the saved default for later commands.",
          ),
        ],
      },
      {
        id: "expected-layout",
        title: "Expected directory layout",
        blocks: [
          code(
            "~/misty-org/\n├── misty/          # desktop application\n├── misty-server/   # Go server and Docker stack\n└── misty-cli/      # this CLI",
            "Filesystem",
          ),
          p(
            "Each directory must be a Git checkout with a .git entry. Doctor and workflows that span repositories validate this layout.",
          ),
        ],
      },
    ],
  },
  {
    path: "/configuration",
    title: "Configuration and environment",
    eyebrow: "Workspace",
    description:
      "Understand path precedence, .env loading, shell overrides, and secret handling.",
    sections: [
      {
        id: "environment-loading",
        title: "How environment values are loaded",
        blocks: [
          p(
            "After resolving the workspace, misty-cli reads the ignored misty-cli/.env file. Existing shell variables are never overwritten. This lets durable local defaults live in the ignored file while one-off terminal exports take priority.",
          ),
          code(
            "# Highest value precedence\nexport R2_BUCKET=temporary-test-bucket\nmisty-cli server r2 configure-cors\n\n# Otherwise read from\n~/misty-org/misty-cli/.env",
          ),
          note(
            "Different from server environment files",
            "The CLI’s .env supplies CLI and release workflows. Docker Compose independently reads misty-server/.env.dev or misty-server/.env.prod for the selected server stack.",
          ),
        ],
      },
      {
        id: "parsing",
        title: "File parsing behavior",
        blocks: [
          list([
            "Blank lines and comments beginning with # are accepted.",
            "KEY=value entries are loaded.",
            "Legacy shell helper lines without an equals sign are ignored.",
            "An exported shell value wins even if the .env file defines the same name.",
            "MISTY_CODESIGN_IDENTITY is copied to APPLE_SIGNING_IDENTITY only when the new name is absent.",
          ]),
        ],
      },
      {
        id: "workspace-variables",
        title: "Workspace and development variables",
        blocks: [
          table(
            ["Variable", "Used by", "Behavior"],
            [
              [
                "MISTY_ORG_ROOT",
                "All commands",
                "Workspace root when --workspace was not supplied.",
              ],
              [
                "MISTY_DESKTOP_DEV_PORT",
                "desktop dev",
                "First port to try; defaults to 5173 and searches up to 49 more ports.",
              ],
              [
                "MISTY_DESKTOP_INITIAL_ROUTE",
                "desktop dev",
                "Fallback initial route when --route was not supplied.",
              ],
              [
                "R2_BUCKET",
                "server r2 configure-cors",
                "Cloudflare R2 bucket whose CORS policy is previewed or updated.",
              ],
              [
                "MISTY_R2_ALLOWED_ORIGINS",
                "server r2 configure-cors",
                "Unique comma-separated HTTPS or approved local/Tauri origins.",
              ],
            ],
          ),
        ],
      },
      {
        id: "release-variables",
        title: "Release variables",
        blocks: [
          table(
            ["Variable", "Required", "Purpose"],
            [
              [
                "TAURI_UPDATER_PUBLIC_KEY",
                "All releases",
                "Validates updater signatures in the installed app.",
              ],
              [
                "TAURI_UPDATER_ENDPOINT",
                "All releases",
                "HTTPS URL serving the static latest.json.",
              ],
              [
                "TAURI_CSP_CONNECT_SOURCES",
                "All releases",
                "Space- or comma-separated HTTPS/WSS origins added to connect-src.",
              ],
              [
                "TAURI_CSP_IMAGE_SOURCES",
                "All releases",
                "Space- or comma-separated HTTPS origins added to img-src.",
              ],
              [
                "TAURI_SIGNING_PRIVATE_KEY",
                "All releases",
                "Signs updater artifacts; consumed by Tauri.",
              ],
              [
                "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
                "All releases",
                "Unlocks the updater signing key.",
              ],
              [
                "APPLE_SIGNING_IDENTITY",
                "macOS",
                "Developer ID identity used by the Tauri/macOS signing process.",
              ],
              [
                "MISTY_NOTARY_KEYCHAIN_PROFILE",
                "macOS",
                "Saved notarytool profile used to submit and staple the DMG.",
              ],
              [
                "WINDOWS_CERTIFICATE_THUMBPRINT",
                "Windows, optional",
                "Enables Authenticode signing when set; must be 40 hexadecimal characters.",
              ],
              [
                "WINDOWS_TIMESTAMP_URL",
                "Windows with certificate",
                "HTTPS timestamp server required when a thumbprint is set.",
              ],
            ],
          ),
          note(
            "Never commit secrets",
            "misty-cli/.env is ignored. .env.example only lists names. Keep signing keys, passwords, API tokens, and notary credentials out of Git and terminal transcripts.",
            "warning",
          ),
        ],
      },
      {
        id: "url-rules",
        title: "Release URL restrictions",
        blocks: [
          list([
            "The updater endpoint must use HTTPS and cannot contain credentials or a URL fragment.",
            "CSP sources cannot use wildcards.",
            "Connect sources allow https:// and wss:// origins only.",
            "Image sources allow https:// origins only.",
            "CSP origins cannot contain credentials, paths, query strings, or fragments.",
          ]),
        ],
      },
    ],
  },
  {
    path: "/doctor",
    title: "misty-cli doctor",
    eyebrow: "Workspace",
    description:
      "Diagnose tooling, authentication, release prerequisites, and repository state.",
    command: "misty-cli doctor",
    sections: [
      {
        id: "checks",
        title: "What doctor checks",
        blocks: [
          table(
            ["Category", "Checks"],
            [
              [
                "Every platform",
                "node, npm, cargo, rustc, rustup, go, docker, gh",
              ],
              ["macOS", "xcodebuild, lipo, codesign, xcrun, spctl"],
              ["Windows", "PowerShell"],
              ["Authentication", "gh auth status"],
              ["Rust targets", "arm64 + x86_64 on macOS; x64 MSVC on Windows"],
              ["Application tools", "Local Tauri CLI and cargo-cyclonedx"],
              [
                "Release inputs",
                "Required variable presence, without exposing values",
              ],
              [
                "Repositories",
                "Clean or has local changes for misty, server, and CLI",
              ],
            ],
          ),
        ],
      },
      {
        id: "usage",
        title: "When to run it",
        blocks: [
          code(
            "misty-cli doctor\n\n# Diagnose another workspace without changing your default\nmisty-cli --workspace /Volumes/code/misty-org doctor",
          ),
          list([
            "After installing the CLI on a new computer.",
            "Before the first platform release.",
            "After updating Xcode, Rust, Node, Docker, or GitHub authentication.",
            "When a command says an external program cannot be started.",
          ]),
        ],
      },
      {
        id: "failure-behavior",
        title: "Failure behavior",
        blocks: [
          p(
            "Missing base commands fail doctor after the availability report. Missing release environment values are informational: ordinary development can still work. A missing Rust release target, failed GitHub authentication, missing Tauri CLI, or missing cargo-cyclonedx is treated as an error.",
          ),
          note(
            "Repository changes are reported, not removed",
            "Doctor never cleans, stashes, resets, or commits your repositories. It only reports whether each checkout has local changes.",
            "success",
          ),
        ],
      },
    ],
  },
  {
    path: "/check",
    title: "misty-cli check",
    eyebrow: "Workspace",
    description:
      "Run repository-native verification locally with the same intent as lean CI.",
    command: "misty-cli check <misty|server|all>",
    sections: [
      {
        id: "targets",
        title: "Targets",
        blocks: [
          table(
            ["Target", "Command", "Scope"],
            [
              [
                "Desktop",
                "misty-cli check misty",
                "React/npm checks and Tauri Rust checks.",
              ],
              [
                "Server",
                "misty-cli check server",
                "Go, database, container, and Worker checks.",
              ],
              [
                "Everything",
                "misty-cli check all",
                "Runs misty first, then server.",
              ],
            ],
          ),
        ],
      },
      {
        id: "misty-checks",
        title: "Desktop checks",
        blocks: [
          p("check misty executes the following from the misty checkout:"),
          list([
            "npm run check: frontend formatting, type checking, Vitest, architecture contracts, and reviewed production dependency audit.",
            "cargo fmt --all -- --check against src-tauri/Cargo.toml.",
            "cargo clippy --all-targets using the repository’s current warning policy.",
            "cargo test --locked for the Tauri Rust workspace.",
          ]),
        ],
      },
      {
        id: "server-checks",
        title: "Server checks",
        blocks: [
          p("check server executes the following from misty-server:"),
          list([
            "gofmt -l . and fails when any Go file needs formatting.",
            "go vet ./... for static analysis.",
            "./test.sh on macOS/Linux, including serialized PostgreSQL-backed tests; Windows uses go test -p 1 ./... -count=1.",
            "scripts/check-container-contract.sh when present.",
            "npm ci in cloudflare/journal-collab.",
            "Worker typecheck, Vitest, runtime integration tests, and production dependency audit.",
          ]),
        ],
      },
      {
        id: "test-database",
        title: "The test database connection",
        blocks: [
          p(
            "Database-backed server tests read TEST_DB_HOST, TEST_DB_PORT, TEST_DB_USER, TEST_DB_PASSWORD, TEST_DB_NAME, and TEST_DB_SSLMODE. Each one falls back to the matching DB_* value from misty-server/.env.dev, so an ordinary development checkout needs no extra configuration.",
          ),
          list([
            "TEST_DB_NAME defaults to DB_NAME with a _test suffix, so tests never truncate the development database.",
            "The migration role is preferred over DB_USER, because the application role is unprivileged and cannot reset tables between tests.",
            "Loopback hosts force sslmode=disable, because the local container serves no TLS.",
            "Set any TEST_DB_* value explicitly to point the suite at a different PostgreSQL instance.",
          ]),
          p(
            "./test.sh bootstraps the container and recreates the test database before running the suite. Once it has run, go test in misty-server resolves the same connection, so targeted reruns such as go test ./test/contract/postgres/... -run TestName work without the full harness.",
          ),
          note(
            "Windows",
            "check server runs go test -p 1 ./... -count=1 instead of ./test.sh, which never bootstraps anything. Start the stack with misty-cli server up --detach first, or the database-backed tests have no PostgreSQL to reach.",
            "warning",
          ),
        ],
      },
      {
        id: "behavior",
        title: "Execution behavior",
        blocks: [
          note(
            "Stops at the first failure",
            "check all does not continue into later stages after a required command fails. Fix the printed failure, then run the command again.",
            "warning",
          ),
          p(
            "The full server test harness can take several minutes because destructive PostgreSQL tests are intentionally serialized. This is expected and protects shared test state.",
          ),
        ],
      },
    ],
  },
];
