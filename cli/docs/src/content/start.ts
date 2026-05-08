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
            "misty coordinates the Misty desktop application, public website, Go server, checks, and releases from one monorepo. It does not replace their native tools; it gives recurring workflows one consistent, guarded entry point.",
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
              ["Website", "Vite development for the public website."],
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
            "misty doctor\nmisty server up --detach\nmisty desktop dev\n# Or start the public website:\nmisty website dev",
          ),
          p(
            "That checks the machine, starts the complete server stack in the background, and opens the Tauri desktop development app. Follow the server with misty server logs and stop it with misty server down.",
          ),
          note(
            "Database-safe by default",
            "misty server down preserves Docker volumes. Database deletion only happens when you explicitly add --volumes.",
            "success",
          ),
        ],
      },
      {
        id: "command-families",
        title: "Command families",
        blocks: [
          code(
            "misty configure --workspace ~/misty-org/misty\nmisty doctor\nmisty check <app|server|all>\nmisty desktop <command>\nmisty website <command>\nmisty server <command>\nmisty release <command>",
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
      "Install misty, point it at your workspace, and validate the machine.",
    sections: [
      {
        id: "requirements",
        title: "Before you begin",
        blocks: [
          p(
            "The default workspace is ~/misty-org/misty. It is one repository containing app/, website/, server/, and cli/, and misty validates those project markers before running a workflow.",
          ),
          table(
            ["Tool", "Used for"],
            [
              [
                "Rust 1.88",
                "Building and installing misty and Misty’s Tauri core.",
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
            "rustup target add x86_64-apple-darwin\ncargo install cargo-cyclonedx --version 0.5.9 --locked\ncargo install --path ~/misty-org/misty/cli --locked --force",
          ),
          note(
            "Apple Silicon",
            "The x86_64-apple-darwin target is required because the release build produces one universal application containing both arm64 and x86_64 code. Intel Macs already use x86_64 natively.",
          ),
          p(
            "The --locked option uses the committed Cargo.lock. --force replaces an older installed misty binary. Re-run the install command after changing CLI source code.",
          ),
        ],
      },
      {
        id: "configure",
        title: "Configure the workspace",
        blocks: [
          code("misty configure --workspace ~/misty-org/misty"),
          p(
            "This stores the workspace path in the operating system’s configuration directory. On macOS, that is under ~/Library/Application Support/misty/cli.toml. It does not copy repositories or edit their configuration.",
          ),
        ],
      },
      {
        id: "validate",
        title: "Validate the machine",
        blocks: [
          code("misty doctor"),
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
            "misty server up --detach\nmisty server logs\n# In another terminal:\nmisty desktop dev",
          ),
          p(
            "Press Control+C to stop following logs; the services continue running because they were started with --detach. End the session with misty server down.",
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
          code("misty server up --detach\nmisty desktop dev --route /spaces"),
          p(
            "server up wraps server/compose.dev.yml, rebuilds images by default, and starts the Space Agent workflow runtime automatically. desktop dev starts Vite through Tauri and opens the requested in-app route.",
          ),
        ],
      },
      {
        id: "observe",
        title: "Watch the server",
        blocks: [
          code("misty server logs"),
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
              ["Tauri Rust", "Restart misty desktop dev."],
              [
                "Go server or Dockerfile",
                "misty server down, then misty server up --detach.",
              ],
              [
                "Only environment values",
                "Restart the affected process or the Compose stack.",
              ],
              [
                "No image-affecting server changes",
                "misty server up --detach --no-build.",
              ],
            ],
          ),
        ],
      },
      {
        id: "check",
        title: "Check before pushing",
        blocks: [
          code("misty check all"),
          p(
            "This is intentionally thorough. It runs the app’s npm and Rust checks, followed by Go, PostgreSQL, container-contract, and Cloudflare Worker checks. Use check app or check server while iterating on one part of the monorepo.",
          ),
        ],
      },
      {
        id: "stop",
        title: "Stop cleanly",
        blocks: [
          code("misty server down"),
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
            "# Fast server restart without rebuilding images\nmisty server down\nmisty server up --detach --no-build\n\n# Isolated desktop identity and data\nmisty desktop dev --profile owner --route /spaces\n\n# Preview cleanup, then apply it\nmisty desktop clean\nmisty desktop clean --apply",
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
      "Options and shortcuts that apply to the misty command surface.",
    command: "misty [OPTIONS] <COMMAND>",
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
              ["-V, --version", "Print the installed misty version."],
            ],
          ),
          code(
            "misty --help\nmisty server --help\nmisty desktop dev --help\nmisty --version",
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
            "misty --workspace /Volumes/work/misty check all\nmisty --workspace ../misty server up --detach",
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
