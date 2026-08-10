import type { DocPage } from "./types";
import { code, list, note, p, table } from "./types";

export const startPages: DocPage[] = [
  {
    path: "/",
    title: "Misty CLI Documentation",
    eyebrow: "Misty CLI",
    badge: "v0.1.0",
    description:
      "One local interface for developing, testing, packaging, and releasing Misty.",
    sections: [
      {
        id: "what-it-does",
        title: "One command surface",
        blocks: [
          p(
            "misty-cli coordinates the three private checkouts in your Misty workspace: the desktop application, the Go server, and the CLI itself. It does not replace their native tools. It gives the recurring workflows one consistent, guarded entry point.",
          ),
          table(
            ["Area", "What the CLI owns"],
            [
              [
                "Workspace",
                "Path resolution, saved configuration, environment loading, and setup diagnostics.",
              ],
              [
                "Desktop",
                "Tauri development, native builds, safe cleanup, icon generation, and Windows asset staging.",
              ],
              [
                "Server",
                "The canonical Docker Compose stack, logs, image builds, Worker secrets, and R2 CORS.",
              ],
              [
                "Checks",
                "The same frontend, Rust, Go, PostgreSQL, container, and Worker checks expected in CI.",
              ],
              [
                "Releases",
                "Identity-locked Mac and Windows builds, uploads, verification, updater metadata, and publication.",
              ],
            ],
          ),
        ],
      },
      {
        id: "quick-start",
        title: "Quick start",
        blocks: [
          code(
            "misty-cli doctor\nmisty-cli server up --detach\nmisty-cli desktop dev",
          ),
          p(
            "That checks the machine, starts the complete server stack in the background, and opens the Tauri desktop development app. Follow the server with misty-cli server logs and stop it with misty-cli server down.",
          ),
          note(
            "Database-safe by default",
            "misty-cli server down preserves Docker volumes. Database deletion only happens when you explicitly add --volumes.",
            "success",
          ),
        ],
      },
      {
        id: "command-families",
        title: "Command families",
        blocks: [
          code(
            "misty-cli configure --workspace ~/misty-org\nmisty-cli doctor\nmisty-cli check <misty|server|all>\nmisty-cli desktop <command>\nmisty-cli server <command>\nmisty-cli release <command>",
          ),
          list([
            "Use --help or -h at any level to inspect available commands and options.",
            "Use --version or -V to print the installed CLI version.",
            "Use --workspace PATH with any command to override workspace discovery for that invocation.",
            "Unknown commands and missing required values exit non-zero and print a concise error.",
          ]),
        ],
      },
      {
        id: "principles",
        title: "Operating principles",
        blocks: [
          list([
            "Local-first: builds and releases happen on the machines that ship the artifacts.",
            "Native tools remain canonical: npm, Cargo, Go, Docker, Wrangler, and GitHub CLI still do the underlying work.",
            "Dry-run first: cleanup, Cloudflare CORS, and release operations expose previews before mutation.",
            "Identity locked: release artifacts cannot mix application commits, CLI commits, versions, or configuration.",
            "Secrets stay private: private signing material is written with restricted permissions and is never printed.",
          ]),
        ],
      },
    ],
  },
  {
    path: "/getting-started",
    title: "Getting started",
    eyebrow: "Start",
    description:
      "Install misty-cli, point it at your workspace, and validate the machine.",
    sections: [
      {
        id: "requirements",
        title: "Before you begin",
        blocks: [
          p(
            "The default workspace is ~/misty-org and must contain Git checkouts named misty, misty-server, and misty-cli. The CLI validates these directories when a workflow needs the full workspace.",
          ),
          table(
            ["Tool", "Used for"],
            [
              [
                "Rust 1.88",
                "Building and installing misty-cli and Misty’s Tauri core.",
              ],
              [
                "Node.js + npm",
                "Frontend, Worker, Tauri CLI, tests, and dependency audits.",
              ],
              ["Go", "Server formatting, vetting, and tests."],
              [
                "Docker",
                "The local server, PostgreSQL, Stripe listener, and supporting services.",
              ],
              ["GitHub CLI", "Authentication and draft release management."],
              [
                "Apple developer tools",
                "Universal builds, signing, notarization, and validation on macOS.",
              ],
            ],
          ),
        ],
      },
      {
        id: "install",
        title: "Install",
        blocks: [
          code(
            "rustup target add x86_64-apple-darwin\ncargo install cargo-cyclonedx --version 0.5.9 --locked\ncargo install --path ~/misty-org/misty-cli --locked --force",
          ),
          note(
            "Apple Silicon",
            "The x86_64-apple-darwin target is required because the release build produces one universal application containing both arm64 and x86_64 code. Intel Macs already use x86_64 natively.",
          ),
          p(
            "The --locked option uses the committed Cargo.lock. --force replaces an older installed misty-cli binary. Re-run the install command after changing CLI source code.",
          ),
        ],
      },
      {
        id: "configure",
        title: "Configure the workspace",
        blocks: [
          code("misty-cli configure --workspace ~/misty-org"),
          p(
            "This stores the workspace path in the operating system’s configuration directory. On macOS, that is under ~/Library/Application Support/misty-cli/config.toml. It does not copy repositories or edit their configuration.",
          ),
        ],
      },
      {
        id: "validate",
        title: "Validate the machine",
        blocks: [
          code("misty-cli doctor"),
          p(
            "Doctor checks tool availability, GitHub authentication, Rust release targets, Tauri tooling, SBOM tooling, release inputs, repository cleanliness, and the resolved workspace. Missing release secrets are reported without printing their values.",
          ),
        ],
      },
      {
        id: "first-session",
        title: "Your first development session",
        blocks: [
          code(
            "misty-cli server up --detach\nmisty-cli server logs\n# In another terminal:\nmisty-cli desktop dev",
          ),
          p(
            "Press Control+C to stop following logs; the services continue running because they were started with --detach. End the session with misty-cli server down.",
          ),
        ],
      },
    ],
  },
  {
    path: "/daily-workflow",
    title: "Daily development workflow",
    eyebrow: "Start",
    description:
      "A practical loop for running, checking, rebuilding, and stopping the whole Misty system.",
    sections: [
      {
        id: "start",
        title: "Start everything",
        blocks: [
          code(
            "misty-cli server up --detach\nmisty-cli desktop dev --route /spaces",
          ),
          p(
            "server up wraps the canonical misty-server Docker Compose file and rebuilds images by default. desktop dev starts Vite through Tauri and opens the requested in-app route.",
          ),
        ],
      },
      {
        id: "observe",
        title: "Watch the server",
        blocks: [
          code("misty-cli server logs"),
          p(
            "The log stream combines services from the Compose project. Control+C only exits the log follower; it does not stop the stack.",
          ),
        ],
      },
      {
        id: "iterate",
        title: "Choose the right restart",
        blocks: [
          table(
            ["Change", "What to run"],
            [
              ["Frontend React/CSS", "Usually nothing; Vite hot reloads."],
              ["Tauri Rust", "Restart misty-cli desktop dev."],
              [
                "Go server or Dockerfile",
                "misty-cli server down, then misty-cli server up --detach.",
              ],
              [
                "Only environment values",
                "Restart the affected process or the Compose stack.",
              ],
              [
                "No image-affecting server changes",
                "misty-cli server up --detach --no-build.",
              ],
            ],
          ),
        ],
      },
      {
        id: "check",
        title: "Check before pushing",
        blocks: [
          code("misty-cli check all"),
          p(
            "This is intentionally thorough. It runs Misty’s npm and Rust checks, followed by Go, PostgreSQL, container-contract, and Cloudflare Worker checks. Use check misty or check server while iterating on only one repository.",
          ),
        ],
      },
      {
        id: "stop",
        title: "Stop cleanly",
        blocks: [
          code("misty-cli server down"),
          note(
            "Keep your data",
            "Do not add --volumes unless you intentionally want to erase Docker volumes, including the local PostgreSQL data.",
            "warning",
          ),
        ],
      },
      {
        id: "useful-combinations",
        title: "Useful command combinations",
        blocks: [
          code(
            "# Fast server restart without rebuilding images\nmisty-cli server down\nmisty-cli server up --detach --no-build\n\n# Isolated desktop identity and data\nmisty-cli desktop dev --profile owner --route /spaces\n\n# Preview cleanup, then apply it\nmisty-cli desktop clean\nmisty-cli desktop clean --apply",
          ),
        ],
      },
    ],
  },
  {
    path: "/command-line",
    title: "Global command-line options",
    eyebrow: "Start",
    description:
      "Options and shortcuts that apply to the misty-cli command surface.",
    command: "misty-cli [OPTIONS] <COMMAND>",
    sections: [
      {
        id: "options",
        title: "Global options",
        blocks: [
          table(
            ["Option", "Meaning"],
            [
              [
                "--workspace <PATH>",
                "Use this workspace root for the current invocation. It has the highest path precedence.",
              ],
              ["-h, --help", "Print help for the current command level."],
              ["-V, --version", "Print the installed misty-cli version."],
            ],
          ),
          code(
            "misty-cli --help\nmisty-cli server --help\nmisty-cli desktop dev --help\nmisty-cli --version",
          ),
        ],
      },
      {
        id: "workspace-position",
        title: "Workspace override",
        blocks: [
          p(
            "--workspace is global, so Clap accepts it with the command surface rather than requiring a permanent configuration change.",
          ),
          code(
            "misty-cli --workspace /Volumes/work/misty-org check all\nmisty-cli --workspace ../misty-org server up --detach",
          ),
          note(
            "Relative paths",
            "A relative workspace path is resolved from the current terminal directory. Prefer an absolute path in scripts.",
          ),
        ],
      },
      {
        id: "exit-behavior",
        title: "Output and exit behavior",
        blocks: [
          list([
            "Underlying commands are echoed before execution, making failures reproducible.",
            "The first failed required step stops the workflow and returns a non-zero exit status.",
            "Captured secrets are never included in the displayed command line.",
            "Validation happens before destructive or remote operations whenever possible.",
          ]),
        ],
      },
    ],
  },
];
