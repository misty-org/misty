export type ContentBlock =
  | { type: "p"; text: string }
  | { type: "list"; items: string[]; ordered?: boolean }
  | { type: "code"; code: string; filename?: string; language?: string }
  | { type: "callout"; title: string; text: string; kind?: "note" | "warning" }
  | { type: "table"; columns: string[]; rows: string[][] }
  | { type: "links"; items: Array<{ title: string; description: string; path: string }> };

export type DocsPage = {
  path: string;
  title: string;
  description: string;
  group: "Overview" | "CLI" | "Extensions" | "Server" | "Reference";
  keywords?: string[];
  source?: { label: string; href: string };
  sections: Array<{
    id: string;
    title: string;
    blocks: ContentBlock[];
  }>;
};

const cliSource = "https://github.com/misty-org/misty-cli";
const extensionsSource = "https://github.com/misty-org/misty-extensions";
const serverSource = "https://github.com/misty-org/misty-server";

export const pages: DocsPage[] = [
  {
    path: "/",
    title: "Misty documentation",
    description: "Build, extend, and operate Misty from one source of truth.",
    group: "Overview",
    keywords: ["getting started", "docs", "open source"],
    sections: [
      {
        id: "choose-a-path",
        title: "Choose a path",
        blocks: [{
          type: "links",
          items: [
            { title: "CLI", description: "Set up the workspace, run each project, validate changes, and prepare releases.", path: "/cli/overview" },
            { title: "Extensions", description: "Create React panels, declare capabilities, and communicate with the Misty host.", path: "/extensions/overview" },
            { title: "Server", description: "Understand the API surface and the boundary between hosted and self-hosted features.", path: "/server/overview" },
          ],
        }],
      },
      {
        id: "quick-start",
        title: "Quick start",
        blocks: [
          { type: "p", text: "The `misty` CLI is the supported development interface for the sibling repositories in `~/misty-org`." },
          { type: "code", filename: "Terminal", language: "shell", code: "cargo install --path ~/misty-org/misty-cli --locked --force\nmisty doctor\nmisty desktop dev" },
        ],
      },
      {
        id: "source-of-truth",
        title: "Source of truth",
        blocks: [
          { type: "p", text: "These docs follow the current CLI command definitions, extension manifests and host bridge, and server route configuration. When documentation and code differ, the code is authoritative." },
          { type: "callout", title: "Scope", text: "The desktop, CLI, and extensions are intended to be open source. Server documentation explains the supported contract and deployment boundary without depending on private implementation details." },
        ],
      },
    ],
  },
  {
    path: "/start",
    title: "Start here",
    description: "Prepare the Misty workspace and run your first local development session.",
    group: "Overview",
    keywords: ["install", "workspace", "doctor", "first run"],
    source: { label: "misty-cli README", href: cliSource + "/blob/main/README.md" },
    sections: [
      {
        id: "prerequisites",
        title: "Prerequisites",
        blocks: [
          { type: "p", text: "The CLI expects the Misty repositories to be siblings inside one workspace. The default is `~/misty-org`." },
          { type: "table", columns: ["Tool", "Used for"], rows: [
            ["Rust and Cargo", "Build and install the CLI and desktop native layer"],
            ["Node.js and npm", "Desktop, website, extensions, and agent runtime"],
            ["Go", "Server development and checks"],
            ["Docker", "Local server stack"],
            ["GitHub CLI", "Authentication and release work"],
          ] },
        ],
      },
      {
        id: "install-the-cli",
        title: "Install the CLI",
        blocks: [
          { type: "code", filename: "Terminal", language: "shell", code: "cd ~/misty-org/misty-cli\ncargo install --path . --locked --force" },
          { type: "p", text: "Re-run this install after changing CLI source. Cargo places the `misty` executable in its normal binary directory." },
        ],
      },
      {
        id: "verify-and-run",
        title: "Verify and run",
        blocks: [
          { type: "code", filename: "Terminal", language: "shell", code: "misty doctor\nmisty check all\nmisty desktop dev" },
          { type: "callout", title: "Different workspace", text: "Run `misty configure --workspace /path/to/misty-org` once, or add `--workspace PATH` to one command without changing the saved default." },
        ],
      },
    ],
  },
  {
    path: "/cli/overview",
    title: "CLI overview",
    description: "Use one command surface across the Misty workspace.",
    group: "CLI",
    keywords: ["misty command", "development", "release"],
    source: { label: "CLI command definitions", href: cliSource + "/blob/main/src/cli.rs" },
    sections: [
      {
        id: "what-it-does",
        title: "What it does",
        blocks: [
          { type: "p", text: "The `misty` CLI is the development and release interface for Misty's sibling repositories. It resolves the workspace, loads only the environment files a command needs, prints the underlying work it runs, and stops on the first required failure." },
          { type: "p", text: "Desktop commands use Tauri's operating-system WebView. They do not download or bundle a separate browser runtime." },
        ],
      },
      {
        id: "command-families",
        title: "Command families",
        blocks: [
          { type: "table", columns: ["Family", "Purpose"], rows: [
            ["`configure`, `doctor`, `check`", "Workspace selection and readiness"],
            ["`env`, `home`", "Private environment files and the cross-platform Misty home"],
            ["`desktop`, `website`", "Application development and builds"],
            ["`server`", "Development and production server operations"],
            ["`release`", "Versioned desktop release workflow"],
          ] },
          { type: "code", filename: "Terminal", language: "shell", code: "misty --help\nmisty server --help\nmisty release start --help" },
        ],
      },
      {
        id: "safety-model",
        title: "Safety model",
        blocks: [
          { type: "p", text: "Read-only commands are the default where a command could remove files or change remote state. `desktop clean` previews candidates until `--apply` is present, and R2 CORS configuration previews until `--apply` is present." },
          { type: "callout", kind: "warning", title: "Remote changes", text: "Release upload and publish, production Worker deploy, and applied R2 CORS configuration mutate remote systems. Use their dry-run or check paths first." },
        ],
      },
    ],
  },
  {
    path: "/cli/install",
    title: "Install and configure",
    description: "Install the CLI and point it at the correct Misty workspace.",
    group: "CLI",
    keywords: ["cargo install", "configure", "workspace"],
    source: { label: "Workspace configuration", href: cliSource + "/blob/main/src/config.rs" },
    sections: [
      {
        id: "install",
        title: "Install",
        blocks: [
          { type: "code", filename: "Terminal", language: "shell", code: "cd ~/misty-org/misty-cli\ncargo install --path . --locked --force\nmisty --version" },
          { type: "p", text: "The current CLI package is version `0.1.0`. `--locked` uses the committed Cargo lockfile; `--force` replaces an older local installation." },
        ],
      },
      {
        id: "workspace-resolution",
        title: "Workspace resolution",
        blocks: [
          { type: "p", text: "The CLI chooses a workspace in this order: the global `--workspace` option, an environment override, the saved CLI configuration, then `~/misty-org`." },
          { type: "code", filename: "Terminal", language: "shell", code: "misty configure --workspace /work/misty-org\nmisty --workspace /tmp/misty-org doctor" },
          { type: "p", text: "The saved selection lives under `~/.misty/cli/config.toml`. Older platform-specific locations are read during migration." },
        ],
      },
      {
        id: "doctor",
        title: "Run doctor",
        blocks: [
          { type: "p", text: "`misty doctor` validates the sibling repositories, required programs, GitHub authentication, Rust targets, Tauri CLI, Cargo CycloneDX, release inputs, and repository status." },
          { type: "code", filename: "Terminal", language: "shell", code: "misty doctor\nmisty check all" },
        ],
      },
    ],
  },
  {
    path: "/cli/commands",
    title: "Command reference",
    description: "The current stable command surface, grouped by workflow.",
    group: "CLI",
    keywords: ["commands", "flags", "options", "reference"],
    source: { label: "CLI command definitions", href: cliSource + "/blob/main/src/cli.rs" },
    sections: [
      {
        id: "workspace-and-checks",
        title: "Workspace and checks",
        blocks: [{ type: "table", columns: ["Command", "Effect"], rows: [
          ["`misty configure --workspace PATH`", "Save the default workspace"],
          ["`misty doctor`", "Validate the complete development toolchain"],
          ["`misty check app|server|website|extensions|cli|all`", "Run repository-specific checks"],
        ] }],
      },
      {
        id: "environment-and-home",
        title: "Environment and home",
        blocks: [{ type: "table", columns: ["Command", "Effect"], rows: [
          ["`misty env migrate`", "Split legacy private files into the scoped layout"],
          ["`misty env init dev|prod`", "Create missing private files without replacing configured values"],
          ["`misty env check dev|prod`", "Validate ownership, permissions, duplicates, and required names"],
          ["`misty env status dev|prod`", "Show configured counts and missing names without printing values"],
          ["`misty home generate [--source PATH] [--destination PATH]`", "Create a deterministic, non-destructive `~/.misty` layout"],
          ["`misty home check [--path PATH]`", "Validate layout, permissions, and retired paths"],
        ] }],
      },
      {
        id: "application-development",
        title: "Application development",
        blocks: [{ type: "table", columns: ["Command", "Effect"], rows: [
          ["`misty desktop dev [--profile NAME] [--route PATH]`", "Start desktop development with an optional isolated profile and route"],
          ["`misty desktop build`", "Create a desktop production build"],
          ["`misty desktop clean [--apply]`", "Preview or remove generated desktop artifacts"],
          ["`misty desktop icons sync [--source PATH]`", "Validate and synchronize application icons"],
          ["`misty desktop windows stage-assets [--source PATH] [--destination PATH]`", "Prepare Windows release assets"],
          ["`misty website dev`", "Start the public website Vite server"],
        ] }],
      },
      {
        id: "server-and-release",
        title: "Server and release",
        blocks: [
          { type: "p", text: "Server and release commands have their own focused guides because several of them affect containers, production infrastructure, or public release state." },
          { type: "links", items: [
            { title: "Server operations", description: "Local stack, production Compose, Worker, image, and R2 commands.", path: "/cli/server" },
            { title: "Release workflow", description: "Start, build, upload, verify, and publish a desktop release.", path: "/cli/releases" },
          ] },
        ],
      },
    ],
  },
  {
    path: "/cli/environments",
    title: "Environments and Misty home",
    description: "Keep private runtime values scoped and portable application assets predictable.",
    group: "CLI",
    keywords: ["env", ".misty", "secrets", "profiles"],
    source: { label: "Environment implementation", href: cliSource + "/blob/main/src/environment.rs" },
    sections: [
      {
        id: "private-environments",
        title: "Private environments",
        blocks: [
          { type: "p", text: "Private files live under the ignored `misty-cli/.env` directory. Commands load only the relevant files and never replace values already exported in the shell." },
          { type: "code", filename: "Terminal", language: "shell", code: "misty env init dev\nmisty env status dev\nmisty env check dev" },
          { type: "callout", title: "No secret output", text: "Status and validation report names and readiness, not secret values." },
        ],
      },
      {
        id: "misty-home",
        title: "Misty home",
        blocks: [
          { type: "p", text: "Desktop Misty uses `~/.misty` on Windows, macOS, and Linux. Generation is idempotent and does not replace existing files." },
          { type: "code", filename: "Terminal", language: "shell", code: "misty home generate\nmisty home check" },
        ],
      },
      {
        id: "portable-seed",
        title: "Portable seed",
        blocks: [
          { type: "p", text: "Generate into another location to prepare a portable seed. Only cross-platform static assets and extension web files are copied." },
          { type: "code", filename: "Terminal", language: "shell", code: "misty home generate \\\n  --source ~/.misty \\\n  --destination ./portable/.misty" },
          { type: "p", text: "Databases, credentials, attachments, mounts, caches, logs, platform binaries, and release keys stay on the source device." },
        ],
      },
    ],
  },
  {
    path: "/cli/server",
    title: "Server operations",
    description: "Run the local stack and perform explicit production infrastructure work.",
    group: "CLI",
    keywords: ["server up", "docker", "worker", "r2", "production"],
    source: { label: "Server command implementation", href: cliSource + "/blob/main/src/server.rs" },
    sections: [
      {
        id: "development-stack",
        title: "Development stack",
        blocks: [
          { type: "code", filename: "Terminal", language: "shell", code: "misty env init dev\nmisty server up --detach\nmisty server url\nmisty server logs" },
          { type: "p", text: "`server up` selects `compose.dev.yml`, builds by default, initializes development secrets when needed, and starts the API, databases, agent runtime, collaboration Worker flow, and supporting services." },
          { type: "p", text: "Use `--no-build` to reuse existing images. `server url` waits for the live tunnel and DNS before printing the current development API origin." },
        ],
      },
      {
        id: "stop-and-reset",
        title: "Stop and reset",
        blocks: [
          { type: "code", filename: "Terminal", language: "shell", code: "misty server down\n# Also delete development volumes:\nmisty server down --volumes" },
          { type: "callout", kind: "warning", title: "Volumes", text: "`--volumes` removes persistent development data owned by the Compose stack. Use it only when a clean database and service state are intended." },
        ],
      },
      {
        id: "production-operations",
        title: "Production operations",
        blocks: [{ type: "table", columns: ["Command", "Effect"], rows: [
          ["`misty server prod check`", "Validate the production environment and deployment inputs"],
          ["`misty server prod up`", "Start the production Compose stack"],
          ["`misty server prod logs`", "Follow production Compose logs"],
          ["`misty server prod down [--volumes]`", "Stop production services, optionally including volumes"],
          ["`misty server image build --tag TAG`", "Build the canonical server image locally"],
          ["`misty server worker generate-secrets --target development|production`", "Generate Worker signing and shared secrets"],
          ["`misty server worker deploy --target production [--dry-run]`", "Validate and deploy the production Worker"],
          ["`misty server r2 configure-cors [--apply]`", "Preview or apply the journal collaboration R2 CORS policy"],
        ] }],
      },
    ],
  },
  {
    path: "/cli/releases",
    title: "Release workflow",
    description: "Prepare and publish a versioned Misty desktop release in explicit stages.",
    group: "CLI",
    keywords: ["release", "publish", "upload", "verify", "dry run"],
    source: { label: "Release implementation", href: cliSource + "/tree/main/src/release" },
    sections: [
      {
        id: "stages",
        title: "Stages",
        blocks: [
          { type: "code", filename: "Terminal", language: "shell", code: "misty release start 0.2.0 --dry-run\nmisty release build 0.2.0 --dry-run\nmisty release upload 0.2.0 --dry-run\nmisty release verify 0.2.0 --dry-run\nmisty release publish 0.2.0 --dry-run" },
          { type: "p", text: "The version must stay the same through every stage. Each stage validates the state created by the previous one." },
        ],
      },
      {
        id: "platform-selection",
        title: "Platform selection",
        blocks: [
          { type: "p", text: "`release start` accepts `--no-macos` and `--no-windows` when a release intentionally excludes one platform. The selected platform set becomes part of the release state." },
        ],
      },
      {
        id: "publication",
        title: "Publication",
        blocks: [
          { type: "p", text: "Upload targets the draft release in `misty-org/misty-public`. Verification checks the remote assets and metadata before publication." },
          { type: "callout", kind: "warning", title: "Public action", text: "`misty release publish VERSION` makes the verified release public. Without `--yes`, it requires the exact confirmation phrase shown by the command." },
        ],
      },
    ],
  },
  {
    path: "/extensions/overview",
    title: "Extensions overview",
    description: "Build web-native tools that run inside Misty.",
    group: "Extensions",
    keywords: ["plugins", "web runtime", "panels", "host bridge"],
    source: { label: "Extension workspace", href: extensionsSource },
    sections: [
      {
        id: "runtime-model",
        title: "Runtime model",
        blocks: [
          { type: "p", text: "Misty extensions are TypeScript and React web surfaces built with Vite and Tailwind CSS. Panels run inside Misty and communicate with native capabilities through a small host bridge." },
          { type: "callout", title: "No native ABI", text: "The current extension workspace does not expose a native plugin ABI. The supported boundary is a web runtime plus validated host commands." },
        ],
      },
      {
        id: "extension-package",
        title: "Extension package",
        blocks: [
          { type: "table", columns: ["File", "Purpose"], rows: [
            ["`manifest.json`", "Runtime, launcher, panels, supported platforms, and bundled tools"],
            ["`plugin.json`", "Hub-facing overview, permissions, getting started, links, and actions"],
            ["`web/index.html` and assets", "Built extension interface"],
            ["`THIRD_PARTY_NOTICES.md`", "Required notices when an extension distributes third-party tools"],
          ] },
        ],
      },
      {
        id: "security-boundary",
        title: "Security boundary",
        blocks: [
          { type: "p", text: "Misty validates the iframe source, extension id, and per-extension command allowlist before native work runs. A panel can request only the host capabilities granted to its package." },
          { type: "p", text: "In a normal browser preview, the panel remains visible but system actions return a clear unavailable result." },
        ],
      },
    ],
  },
  {
    path: "/extensions/build",
    title: "Build an extension",
    description: "Create, preview, test, and build a Misty extension panel.",
    group: "Extensions",
    keywords: ["react", "vite", "development", "plugin query"],
    source: { label: "Extension workspace README", href: extensionsSource + "/blob/main/README.md" },
    sections: [
      {
        id: "development",
        title: "Development",
        blocks: [
          { type: "code", filename: "Terminal", language: "shell", code: "cd ~/misty-org/misty-extensions\nnpm install\nnpm run dev" },
          { type: "p", text: "Open a panel with the `plugin` query parameter. Add one or more `selected` values to simulate file selection." },
          { type: "code", filename: "Browser", language: "text", code: "http://127.0.0.1:5174/?plugin=quick_convert\nhttp://127.0.0.1:5174/?plugin=quick_convert&selected=/Users/me/Desktop/demo.mov" },
        ],
      },
      {
        id: "register-the-panel",
        title: "Register the panel",
        blocks: [
          { type: "p", text: "A panel component receives `MistyPluginContext`: the extension id, current selection, hosted state, notification helper, host command function, and current semantic theme snapshot." },
          { type: "code", filename: "src/plugins/example/ExamplePlugin.tsx", language: "tsx", code: "import type { PluginPanelProps } from \"../types\";\n\nexport function ExamplePlugin({ context }: PluginPanelProps) {\n  return (\n    <button onClick={() => context.notify(\"success\", \"Example\", \"Done\")}>\n      Run example\n    </button>\n  );\n}" },
        ],
      },
      {
        id: "validate-and-build",
        title: "Validate and build",
        blocks: [
          { type: "code", filename: "Terminal", language: "shell", code: "npm test\nnpm run validate\nnpm run build" },
          { type: "p", text: "The build emits the shared web application, extension metadata, assets, and public catalog files under `dist/`." },
        ],
      },
    ],
  },
  {
    path: "/extensions/manifest",
    title: "Extension manifest",
    description: "Declare the runtime, launcher placement, panels, and platform tools.",
    group: "Extensions",
    keywords: ["manifest.json", "schema_version", "launcher", "tools"],
    source: { label: "Extension manifests", href: extensionsSource + "/tree/main/extensions" },
    sections: [
      {
        id: "minimal-manifest",
        title: "Minimal manifest",
        blocks: [
          { type: "code", filename: "extensions/example/manifest.json", language: "json", code: "{\n  \"schema_version\": 3,\n  \"id\": \"example\",\n  \"name\": \"Example\",\n  \"version\": \"0.1.0\",\n  \"description\": \"Do one useful thing.\",\n  \"author\": \"Your name\",\n  \"enabled\": true,\n  \"platforms\": [\"web\"],\n  \"runtime\": { \"type\": \"web\", \"entry\": \"web/index.html?plugin=example\" },\n  \"launcher\": {\n    \"views\": [\"Files\"],\n    \"show_in_launcher\": true,\n    \"requires_selected_file\": false,\n    \"open_mode\": \"tab\"\n  },\n  \"panels\": [{\n    \"id\": \"example.panel\",\n    \"title\": \"Example\",\n    \"window_type\": \"panel\",\n    \"default_width\": 620,\n    \"default_height\": 520,\n    \"entry\": \"web/index.html?plugin=example\"\n  }]\n}" },
        ],
      },
      {
        id: "launcher",
        title: "Launcher",
        blocks: [
          { type: "p", text: "`views` controls where the extension appears. Current first-party examples use `Files`, `settings`, `plugins`, or `all`. `requires_selected_file` prevents opening a file-scoped tool without a selection." },
          { type: "p", text: "The supported open mode is `tab`. Catalog validation rejects mismatched launcher metadata." },
        ],
      },
      {
        id: "bundled-tools",
        title: "Bundled tools",
        blocks: [
          { type: "p", text: "A `tools` entry pins an id, version, operating system, architecture, and package-relative executable path. Release packaging keeps only the entries that match each target artifact." },
          { type: "callout", kind: "warning", title: "Licensing", text: "An extension that distributes tools such as FFmpeg, Restic, rclone, or yt-dlp must include matching third-party notices and any license or source offer required by that build." },
        ],
      },
    ],
  },
  {
    path: "/extensions/host-bridge",
    title: "Host bridge",
    description: "Request selected paths, notifications, jobs, tools, and native actions safely.",
    group: "Extensions",
    keywords: ["postMessage", "runHostCommand", "context", "theme"],
    source: { label: "Typed host bridge", href: extensionsSource + "/blob/main/src/mistyBridge.ts" },
    sections: [
      {
        id: "handshake",
        title: "Handshake",
        blocks: [
          { type: "p", text: "A hosted panel announces a `misty-plugin` ready message containing its extension id and protocol version `1`. Misty replies with a `misty-host` context message for the same id." },
          { type: "code", filename: "Protocol shape", language: "ts", code: "{\n  channel: \"misty-plugin\",\n  kind: \"ready\",\n  pluginId: \"example\",\n  protocolVersion: 1\n}" },
        ],
      },
      {
        id: "context-and-theme",
        title: "Context and theme",
        blocks: [
          { type: "p", text: "Host context contains the selected paths and a semantic theme snapshot. Apply the snapshot instead of hard-coding Misty colors." },
          { type: "p", text: "Available semantic tokens include background, surfaces, borders, text levels, primary, accent, focus, selection, success, warning, danger, info, and shadow." },
        ],
      },
      {
        id: "commands",
        title: "Commands",
        blocks: [
          { type: "p", text: "Call `context.runHostCommand(command, payload)` and handle both successful results and `{ ok: false, message }` responses. Hosted requests time out after 30 seconds." },
          { type: "table", columns: ["Command family", "Examples in first-party extensions"], rows: [
            ["Host", "`host.selectedPaths`, `host.pickFolders`, `host.notify`, `host.revealOutput`"],
            ["Dependencies", "`dependencies.check`"],
            ["Jobs", "`jobs.latest`, `jobs.status`, `jobs.cancel`"],
            ["Backups", "`backups.repositories`, `backups.repository.init`, `backups.snapshots`"],
            ["yt-dlp", "`ytdlp.inspect`"],
          ] },
          { type: "callout", title: "Allowlist", text: "A command name appearing here does not grant access by itself. Misty still checks the active extension's native command allowlist." },
        ],
      },
    ],
  },
  {
    path: "/extensions/publishing",
    title: "Publish an extension",
    description: "Validate metadata and produce platform-specific install artifacts.",
    group: "Extensions",
    keywords: ["catalog", "package release", "zip", "sha256"],
    source: { label: "Release packaging", href: extensionsSource + "/tree/main/scripts" },
    sections: [
      {
        id: "catalog-entry",
        title: "Catalog entry",
        blocks: [
          { type: "p", text: "Each public extension has a catalog record with version, overview, capabilities, placement, permissions, getting-started steps, changelog, actions, launcher metadata, install artifacts, and logo URL." },
          { type: "p", text: "`catalog/index.json` maps stable ids and names to the raw catalog records on GitHub." },
        ],
      },
      {
        id: "validation",
        title: "Validation",
        blocks: [
          { type: "code", filename: "Terminal", language: "shell", code: "npm run validate\nnpm run build" },
          { type: "p", text: "Validation checks ids, schema versions, runtime and launcher consistency, required metadata, bundled tool declarations, and third-party notices." },
        ],
      },
      {
        id: "release-artifacts",
        title: "Release artifacts",
        blocks: [
          { type: "code", filename: "Terminal", language: "shell", code: "npm run package:release" },
          { type: "p", text: "Packaging creates one zip per supported platform and architecture, filters the manifest's tools to that target, calculates SHA-256 digests, and writes release-ready catalog records." },
        ],
      },
    ],
  },
  {
    path: "/extensions/official",
    title: "Official extensions",
    description: "The first-party extension catalog currently maintained by Misty.",
    group: "Extensions",
    keywords: ["quick convert", "themes", "storage report", "image optimizer", "backups", "yt-dlp"],
    source: { label: "Public catalog", href: extensionsSource + "/tree/main/catalog" },
    sections: [
      {
        id: "catalog",
        title: "Catalog",
        blocks: [{ type: "table", columns: ["Extension", "Purpose", "Launcher"], rows: [
          ["Storage Report", "Read-only recursive folder size, largest-file, and type analysis", "Files; selection required"],
          ["Image Optimizer", "Smaller JPEG, PNG, and WebP copies with FFmpeg", "Files; selection required"],
          ["Quick Convert", "Image, audio, and video conversion with FFmpeg", "Files; selection required"],
          ["Backups", "Encrypted Restic snapshots to local volumes or cloud remotes", "All views"],
          ["Themes", "Misty theme presets and semantic token editing", "Settings and extensions"],
          ["yt-dlp", "YouTube media download and conversion", "All views"],
        ] }],
      },
      {
        id: "compatibility",
        title: "Compatibility",
        blocks: [
          { type: "p", text: "Current catalog packages are version `0.3.0`. Platform artifacts cover macOS arm64 and x86_64, Windows x86_64, and Linux x86_64 where bundled tools are required." },
        ],
      },
    ],
  },
  {
    path: "/server/overview",
    title: "Server overview",
    description: "Understand the hosted and self-hosted server boundary.",
    group: "Server",
    keywords: ["backend", "go api", "agent runtime", "cloudflare"],
    source: { label: "Server repository", href: serverSource },
    sections: [
      {
        id: "repository",
        title: "Repository",
        blocks: [
          { type: "p", text: "The server repository contains the Go API, PostgreSQL migrations, durable agent workflow runtime, collaborative journal and drawing Worker, and managed and self-hosted deployment assets." },
          { type: "table", columns: ["Area", "Responsibility"], rows: [
            ["Go API", "HTTP contract, authentication, spaces, content, integrations, and orchestration"],
            ["PostgreSQL", "Durable application state and pgvector-backed search"],
            ["Agent runtime", "Durable AI workflow execution"],
            ["Collaboration Worker", "Realtime journal and drawing collaboration"],
            ["Activepieces", "Sandboxed workflow automation services in the development stack"],
          ] },
        ],
      },
      {
        id: "public-contract",
        title: "Public contract",
        blocks: [
          { type: "p", text: "`/v1` is the canonical hosted API prefix. `/api` and the bare route tree remain available for self-hosted installations and existing desktop releases." },
          { type: "p", text: "The API serves health and instance discovery, account sessions, spaces, conversations, tasks, calendars, library content, notes, drawings, realtime tickets, AI and agents, integrations, and billing where the deployment supports them." },
        ],
      },
      {
        id: "operating-model",
        title: "Operating model",
        blocks: [
          { type: "p", text: "A server reports its deployment mode, protocol range, registration policy, storage backend, and capability flags through the instance descriptor. Clients should use that descriptor instead of assuming every server exposes the hosted feature set." },
          { type: "links", items: [
            { title: "Capabilities", description: "Compare hosted and self-hosted behavior.", path: "/server/capabilities" },
            { title: "HTTP API", description: "Learn prefixes, authentication, and resource families.", path: "/server/http-api" },
          ] },
        ],
      },
    ],
  },
  {
    path: "/server/capabilities",
    title: "Server capabilities",
    description: "Discover what a server supports before enabling a client feature.",
    group: "Server",
    keywords: ["instance descriptor", "hosted", "self-hosted", "capability flags"],
    source: { label: "Instance descriptor", href: serverSource + "/blob/main/internal/platform/httpapi/instance.go" },
    sections: [
      {
        id: "instance-endpoint",
        title: "Instance endpoint",
        blocks: [
          { type: "code", filename: "Request", language: "http", code: "GET /v1/instance" },
          { type: "code", filename: "Representative response", language: "json", code: "{\n  \"server_id\": \"…\",\n  \"name\": \"Misty Hosted\",\n  \"deployment\": \"hosted\",\n  \"protocol_version\": 1,\n  \"min_client_protocol\": 1,\n  \"max_client_protocol\": 1,\n  \"capabilities\": {\n    \"collaboration\": true,\n    \"library\": true,\n    \"notes\": true,\n    \"drawings\": true,\n    \"hosted_billing\": true,\n    \"hosted_integrations\": true,\n    \"hosted_ai\": true,\n    \"storage_backend\": \"s3\"\n  },\n  \"bootstrap_required\": false,\n  \"registration\": \"open\"\n}" },
        ],
      },
      {
        id: "deployment-matrix",
        title: "Deployment matrix",
        blocks: [{ type: "table", columns: ["Capability", "Hosted", "Self-hosted"], rows: [
          ["Collaboration", "Available", "Available"],
          ["Library", "Available", "Available"],
          ["Notes", "Available", "Available"],
          ["Drawings", "Available", "Available"],
          ["Billing", "Hosted billing", "Not exposed as a hosted feature"],
          ["Integrations", "Available when configured", "Blocked by the self-host feature gate"],
          ["AI and agents", "Available when configured", "Blocked by the self-host feature gate"],
          ["Storage", "S3 by default", "Filesystem when configured, otherwise S3-compatible"],
          ["Registration", "Open", "Invitation after bootstrap"],
        ] }],
      },
      {
        id: "client-behavior",
        title: "Client behavior",
        blocks: [
          { type: "list", items: [
            "Reject an incompatible protocol range before attempting authenticated work.",
            "Hide or disable hosted-only features when the corresponding flag is false.",
            "Use the reported storage backend only as a capability hint; never infer credentials or paths.",
            "If `bootstrap_required` is true, guide the operator through self-host bootstrap before enrollment.",
          ] },
        ],
      },
    ],
  },
  {
    path: "/server/http-api",
    title: "HTTP API",
    description: "Use the versioned Misty server contract and its resource families.",
    group: "Server",
    keywords: ["v1", "api", "authentication", "endpoints", "rate limit"],
    source: { label: "Mounted routes", href: serverSource + "/blob/main/internal/app/server_mount_handlers.go" },
    sections: [
      {
        id: "base-url",
        title: "Base URL",
        blocks: [
          { type: "table", columns: ["Environment", "Base"], rows: [
            ["Production", "`https://api.mistysys.com/v1`"],
            ["Development", "`https://dev-api.mistysys.com/v1`"],
            ["Local Compose", "`http://127.0.0.1:8081/v1`"],
          ] },
          { type: "callout", title: "Canonical prefix", text: "Use `/v1` for new hosted clients. The `/api` and bare aliases exist for compatibility and self-hosting." },
        ],
      },
      {
        id: "resource-families",
        title: "Resource families",
        blocks: [{ type: "table", columns: ["Family", "Includes"], rows: [
          ["Instance and auth", "Health, instance descriptor, registration, login, logout, reset, handoff"],
          ["Account", "Profile, avatar, device, settings, telemetry, export, deletion"],
          ["Spaces", "Membership, invitations, permissions, messages, conversations, realtime"],
          ["Planning", "Tasks, agenda, calendar, roadmaps, goals, milestones"],
          ["Content", "Library, uploads, downloads, previews, albums, notes, drawings"],
          ["Intelligence", "Search, AI runs, conversations, agents, media search"],
          ["Integrations", "Provider connections, GitHub, Figma, mail, calendar, social"],
          ["Billing", "Trial, checkout, portal, usage, self-host entitlement"],
        ] }],
      },
      {
        id: "authentication-and-mutations",
        title: "Authentication and mutations",
        blocks: [
          { type: "p", text: "The server accepts the session forms used by Misty clients and protects state-changing work with route-specific authorization. Some agent and device paths add signed request headers." },
          { type: "p", text: "Mutation handlers reject unknown JSON fields and oversized or trailing bodies. Invalid input returns a JSON error code instead of an empty success." },
          { type: "callout", title: "Idempotency", text: "AI and agent-runtime mutations may require or accept `Idempotency-Key`. Preserve the same key when retrying an uncertain request." },
        ],
      },
      {
        id: "limits-and-errors",
        title: "Limits and errors",
        blocks: [
          { type: "p", text: "The public router applies CORS policy, request observability, a persistent abuse guard, per-route rate limits, metrics, self-host feature gating, and entitlement checks before handlers run." },
          { type: "p", text: "Clients should treat non-2xx responses as structured failures, honor `Retry-After` when present, and retain `X-Request-ID` for support and logs." },
        ],
      },
    ],
  },
  {
    path: "/server/local-development",
    title: "Local server development",
    description: "Start the complete development backend through the Misty CLI.",
    group: "Server",
    keywords: ["compose.dev.yml", "localhost", "tunnel", "docker"],
    source: { label: "Development Compose stack", href: serverSource + "/blob/main/compose.dev.yml" },
    sections: [
      {
        id: "initialize",
        title: "Initialize",
        blocks: [
          { type: "code", filename: "Terminal", language: "shell", code: "misty env init dev\nmisty env check dev" },
          { type: "p", text: "Initialization creates the scoped development files and the local signing and shared secrets required by connected devices and the collaboration Worker." },
        ],
      },
      {
        id: "start",
        title: "Start",
        blocks: [
          { type: "code", filename: "Terminal", language: "shell", code: "misty server up --detach\nmisty server url" },
          { type: "p", text: "The stack binds PostgreSQL and the Go API to loopback ports. A Cloudflare tunnel provides the callback-capable development API origin used by external providers." },
        ],
      },
      {
        id: "observe",
        title: "Observe and stop",
        blocks: [
          { type: "code", filename: "Terminal", language: "shell", code: "misty server logs\n# In another terminal when finished:\nmisty server down" },
          { type: "p", text: "The tunnel hostname can change when its container is recreated. Run `misty server url` again and restart desktop development if the API origin changes." },
        ],
      },
    ],
  },
  {
    path: "/server/self-hosting",
    title: "Self-hosting",
    description: "Operate the collaboration and content surface with an explicit hosted-feature boundary.",
    group: "Server",
    keywords: ["self hosted", "bootstrap", "invitation", "entitlement", "filesystem"],
    source: { label: "Self-host contract", href: serverSource + "/blob/main/internal/platform/httpapi/self_host_accounts.go" },
    sections: [
      {
        id: "deployment-mode",
        title: "Deployment mode",
        blocks: [
          { type: "p", text: "A server is self-hosted when `MISTY_DEPLOYMENT_MODE=self_hosted`. Its instance descriptor reports invitation registration, bootstrap state, storage backend, and hosted-only capability flags as unavailable." },
        ],
      },
      {
        id: "account-lifecycle",
        title: "Account lifecycle",
        blocks: [
          { type: "list", ordered: true, items: [
            "The operator uses the one-time bootstrap path to create the first account.",
            "The server switches to invitation-based enrollment.",
            "New users enroll with an invitation and a valid self-host entitlement proof.",
            "Recovery paths remain available for health, discovery, login, logout, bootstrap, enrollment, and entitlement renewal.",
          ] },
        ],
      },
      {
        id: "available-surface",
        title: "Available surface",
        blocks: [
          { type: "p", text: "Self-hosted deployments retain collaboration, spaces, library, notes, drawings, account sessions, and the storage backend selected by the operator." },
          { type: "p", text: "The feature gate blocks hosted AI, agents, billing workflows, cloud connections, provider integrations, waitlist, hosted password handoff, and related provider resources." },
          { type: "callout", kind: "warning", title: "Discover, do not assume", text: "Use `/v1/instance` at connection time. Self-host capabilities can evolve independently of a desktop release." },
        ],
      },
      {
        id: "storage",
        title: "Storage",
        blocks: [
          { type: "p", text: "A self-hosted instance reports `filesystem` when `MISTY_LIBRARY_FILESYSTEM_DIR` is configured. Otherwise it reports `s3`, allowing an operator-managed S3-compatible object store." },
        ],
      },
    ],
  },
  {
    path: "/reference/domains",
    title: "Domains and environments",
    description: "Canonical public origins for Misty documentation and APIs.",
    group: "Reference",
    keywords: ["docs.mistysys.com", "dev-docs", "api", "domains"],
    sections: [
      {
        id: "documentation",
        title: "Documentation",
        blocks: [{ type: "table", columns: ["Environment", "Origin"], rows: [
          ["Production", "`https://docs.mistysys.com`"],
          ["Development", "`https://dev-docs.mistysys.com`"],
          ["Local Vite", "`http://127.0.0.1:5175`"],
        ] }],
      },
      {
        id: "api",
        title: "API",
        blocks: [{ type: "table", columns: ["Environment", "Canonical base"], rows: [
          ["Production", "`https://api.mistysys.com/v1`"],
          ["Development", "`https://dev-api.mistysys.com/v1`"],
          ["Local Compose", "`http://127.0.0.1:8081/v1`"],
        ] }],
      },
      {
        id: "deployment-metadata",
        title: "Deployment metadata",
        blocks: [
          { type: "p", text: "Production builds use `https://docs.mistysys.com` for canonical and social metadata. Development deployments should set `VITE_DOCS_ORIGIN=https://dev-docs.mistysys.com` so page metadata points at the development origin." },
        ],
      },
    ],
  },
];

export const navigation = [
  {
    label: "Overview",
    items: [
      { label: "Introduction", path: "/" },
      { label: "Start here", path: "/start" },
    ],
  },
  {
    label: "CLI",
    items: [
      { label: "Overview", path: "/cli/overview" },
      { label: "Install and configure", path: "/cli/install" },
      { label: "Command reference", path: "/cli/commands" },
      { label: "Environments and home", path: "/cli/environments" },
      { label: "Server operations", path: "/cli/server" },
      { label: "Release workflow", path: "/cli/releases" },
    ],
  },
  {
    label: "Extensions",
    items: [
      { label: "Overview", path: "/extensions/overview" },
      { label: "Build an extension", path: "/extensions/build" },
      { label: "Manifest", path: "/extensions/manifest" },
      { label: "Host bridge", path: "/extensions/host-bridge" },
      { label: "Publishing", path: "/extensions/publishing" },
      { label: "Official extensions", path: "/extensions/official" },
    ],
  },
  {
    label: "Server",
    items: [
      { label: "Overview", path: "/server/overview" },
      { label: "Capabilities", path: "/server/capabilities" },
      { label: "HTTP API", path: "/server/http-api" },
      { label: "Local development", path: "/server/local-development" },
      { label: "Self-hosting", path: "/server/self-hosting" },
    ],
  },
  {
    label: "Reference",
    items: [
      { label: "Domains and environments", path: "/reference/domains" },
    ],
  },
];

export function pageByPath(pathname: string) {
  return pages.find((page) => page.path === pathname);
}
