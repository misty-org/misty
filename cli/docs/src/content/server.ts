import type { DocPage } from "./types";
import { code, list, note, p, table } from "./types";

export const serverPages: DocPage[] = [
  {
    path: "/server",
    title: "Server commands",
    eyebrow: "Server",
    description:
      "Run the canonical local system and manage focused server infrastructure tasks.",
    sections: [
      {
        id: "commands",
        title: "Available commands",
        blocks: [
          table(
            ["Command", "Purpose"],
            [
              [
                "server up",
                "Start the canonical Docker Compose development stack.",
              ],
              [
                "server down",
                "Stop the stack, preserving volumes unless explicitly requested.",
              ],
              ["server url", "Print the current temporary Cloudflare API URL."],
              ["server logs", "Follow combined Compose service logs."],
              [
                "server image build",
                "Build the server image directly with an explicit tag.",
              ],
              [
                "server worker generate-secrets",
                "Generate Journal collaboration signing and control secrets.",
              ],
              [
                "server r2 configure-cors",
                "Preview or apply the approved R2 CORS policy.",
              ],
            ],
          ),
        ],
      },
      {
        id: "full-system",
        title: "Full local system",
        blocks: [
          code(
            "misty-cli server up --detach\nmisty-cli server logs\n\n# When finished\nmisty-cli server down",
          ),
          p(
            "The CLI intentionally wraps misty-server’s existing Docker Compose stack. Compose remains the source of truth for PostgreSQL, migrations, permissions, the API, Stripe forwarding, Cloudflare development services, and any other declared dependency.",
          ),
          p(
            "Detached startup prints the public HTTPS API base after the Cloudflare tunnel is ready. Run misty-cli server url later to print the same value again.",
          ),
        ],
      },
    ],
  },
  {
    path: "/server/up",
    title: "misty-cli server up",
    eyebrow: "Server",
    description:
      "Start the complete misty-server Docker Compose stack, rebuilding images by default.",
    command: "misty-cli server up [--detach] [--no-build]",
    sections: [
      {
        id: "options",
        title: "Options",
        blocks: [
          table(
            ["Option", "Default", "Description"],
            [
              [
                "--detach",
                "False",
                "Start services in the background and return to the prompt.",
              ],
              ["--no-build", "False", "Do not pass --build to Docker Compose."],
            ],
          ),
        ],
      },
      {
        id: "examples",
        title: "Examples",
        blocks: [
          code(
            "# Attached; rebuild images and stream output\nmisty-cli server up\n\n# Background; rebuild images\nmisty-cli server up --detach\n\n# Background; reuse existing images\nmisty-cli server up --detach --no-build",
          ),
        ],
      },
      {
        id: "docker-mapping",
        title: "Docker mapping",
        blocks: [
          table(
            ["CLI command", "Underlying command"],
            [
              [
                "server up",
                "docker compose --env-file .env.dev -f compose.dev.yml up --build",
              ],
              [
                "server up --detach",
                "docker compose --env-file .env.dev -f compose.dev.yml up --build --detach",
              ],
              [
                "server up --no-build",
                "docker compose --env-file .env.dev -f compose.dev.yml up",
              ],
              [
                "server up --detach --no-build",
                "docker compose --env-file .env.dev -f compose.dev.yml up --detach",
              ],
            ],
          ),
          p(
            "--build asks Compose to rebuild buildable service images before starting containers. Use it after changing Go code, Dockerfiles, dependencies, or build context. --no-build is faster when the existing image is already correct.",
          ),
        ],
      },
      {
        id: "environment",
        title: "Environment behavior",
        blocks: [
          p(
            "The command runs from the misty-server checkout and explicitly selects compose.dev.yml with .env.dev. The Go server itself does not load an environment file.",
          ),
          note(
            "Attached mode",
            "In attached mode, Control+C asks Compose to stop the foreground session. Use --detach when you want to keep services running while using the same terminal.",
          ),
        ],
      },
    ],
  },
  {
    path: "/server/url",
    title: "misty-cli server url",
    eyebrow: "Server",
    description:
      "Print the current temporary Cloudflare URL for the development API.",
    command: "misty-cli server url",
    sections: [
      {
        id: "usage",
        title: "Use the public development endpoint",
        blocks: [
          code(
            'misty-cli server up --detach\nmisty-cli server url\n# https://example.trycloudflare.com/api\n\nMISTY_PUBLIC_API_URL="$(misty-cli server url)" misty-cli desktop dev',
          ),
          p(
            "The URL reaches the same API container as localhost:8081, but travels through Cloudflare over HTTPS. It is useful for production-like desktop testing and clients that cannot reach your machine’s loopback interface.",
          ),
          note(
            "Temporary hostname",
            "The trycloudflare.com hostname changes when the tunnel container is recreated. The command checks cloudflared’s live connection and waits for Cloudflare DNS directly before printing, avoiding an early failed lookup in the desktop. Restart desktop dev whenever the hostname changes.",
          ),
        ],
      },
    ],
  },
  {
    path: "/server/down",
    title: "misty-cli server down",
    eyebrow: "Server",
    description:
      "Stop and remove Compose containers and networks, with an explicit opt-in for deleting volumes.",
    command: "misty-cli server down [--volumes]",
    sections: [
      {
        id: "safe-default",
        title: "Safe default",
        blocks: [
          code("misty-cli server down"),
          p(
            "This selects compose.dev.yml and runs Docker Compose down from misty-server. Containers and the Compose network are removed, while named volumes are preserved. Your local PostgreSQL data survives the next server up.",
          ),
        ],
      },
      {
        id: "volumes",
        title: "Delete local volumes",
        blocks: [
          code("misty-cli server down --volumes"),
          note(
            "Destructive",
            "--volumes passes Docker’s --volumes option. It can erase the development database and other persistent Compose data. There is no automatic backup or undo.",
            "danger",
          ),
        ],
      },
      {
        id: "when-to-use",
        title: "When to delete volumes",
        blocks: [
          list([
            "You intentionally want a completely fresh development database.",
            "A local volume is corrupt and cannot be repaired in place.",
            "You are validating first-run migrations from an empty state.",
          ]),
          p(
            "For ordinary restarts, configuration changes, and image rebuilds, use server down without --volumes.",
          ),
        ],
      },
    ],
  },
  {
    path: "/server/logs",
    title: "misty-cli server logs",
    eyebrow: "Server",
    description:
      "Follow combined output from every service in the misty-server Compose project.",
    command: "misty-cli server logs",
    sections: [
      {
        id: "usage",
        title: "Usage",
        blocks: [
          code("misty-cli server logs"),
          p(
            "The command selects compose.dev.yml and runs Docker Compose logs --follow. Existing recent logs are printed and new output continues to stream.",
          ),
        ],
      },
      {
        id: "controls",
        title: "Controls and behavior",
        blocks: [
          list([
            "Press Control+C to stop following logs.",
            "Stopping the follower does not stop detached services.",
            "Service prefixes identify which Compose container emitted each line.",
            "Run server down separately when you want to stop the system.",
          ]),
        ],
      },
      {
        id: "workflow",
        title: "Background workflow",
        blocks: [
          code(
            "misty-cli server up --detach\nmisty-cli server logs\n# Control+C exits logs\nmisty-cli server down",
          ),
        ],
      },
    ],
  },
  {
    path: "/server/image",
    title: "misty-cli server image build",
    eyebrow: "Server",
    description:
      "Build the canonical misty-server Docker image directly and assign an explicit tag.",
    command: "misty-cli server image build --tag <TAG>",
    sections: [
      {
        id: "usage",
        title: "Usage",
        blocks: [
          code(
            "misty-cli server image build --tag misty-server:local\nmisty-cli server image build --tag ghcr.io/misty-org/misty-server:0.2.0",
          ),
          table(
            ["Option", "Required", "Description"],
            [
              [
                "--tag <TAG>",
                "Yes",
                "Docker image name and optional tag. Empty values are rejected.",
              ],
            ],
          ),
        ],
      },
      {
        id: "behavior",
        title: "What it runs",
        blocks: [
          code("docker build --tag <TAG> ."),
          p(
            "The build context is the misty-server checkout and uses its canonical Dockerfile. This command only creates a local image; it does not push to a registry, start containers, run tests, or deploy.",
          ),
          note(
            "Test first",
            "Run misty-cli check server before treating an image as a deployment candidate.",
          ),
        ],
      },
    ],
  },
  {
    path: "/server/worker",
    title: "misty-cli server worker generate-secrets",
    eyebrow: "Server",
    description:
      "Generate a verified Journal collaboration signing pair and independent control secrets.",
    command:
      "misty-cli server worker generate-secrets [--target development|production]",
    sections: [
      {
        id: "usage",
        title: "Usage",
        blocks: [
          code(
            "misty-cli server worker generate-secrets\nmisty-cli server worker generate-secrets --target production",
          ),
          p(
            "The command generates an Ed25519 signing keypair with the operating system random generator, signs and verifies a probe message, and creates three independent 32-byte random secrets.",
          ),
        ],
      },
      {
        id: "outputs",
        title: "Generated files",
        blocks: [
          table(
            ["File", "Contents"],
            [
              [
                "cloudflare/journal-collab/.dev.vars",
                "Public ticket key, control secret, and projection secret for the local Worker.",
              ],
              [
                "cloudflare/journal-collab/.secrets/server.env",
                "Private signing key and matching control/projection secrets for the server.",
              ],
              [
                ".env.dev",
                "The stable server-only room salt. An existing valid value is preserved across signing-key rotations.",
              ],
              [
                ".env.prod",
                "For the production target, the three first-use placeholders are replaced while the existing room salt is preserved.",
              ],
              [
                "cloudflare/journal-collab/.secrets/worker.prod.env",
                "Production public ticket key and matching control/projection secrets for Wrangler.",
              ],
            ],
          ),
          p(
            "On Unix, files are written with mode 0600. Development Worker files are replaced. The production target refuses to overwrite configured secrets, preventing an accidental uncoordinated rotation.",
          ),
        ],
      },
      {
        id: "secret-boundary",
        title: "Secret boundary",
        blocks: [
          list([
            "The Worker receives only the public signing key.",
            "The private signing key belongs only in the server environment.",
            "The room salt should remain stable when the signing key rotates.",
            "The command prints file locations but never prints the private key.",
            "The three public Worker values must be installed through Wrangler secrets for the deployed Worker.",
          ]),
          note(
            "Rotation",
            "Development generation replaces its local Worker files. Production generation is first-use only and refuses to rotate configured credentials; production rotation requires the coordinated previous-key procedure.",
            "warning",
          ),
        ],
      },
      {
        id: "production-deploy",
        title: "Production deployment",
        blocks: [
          code(
            "misty-cli server worker deploy --target production --dry-run\nmisty-cli server worker deploy --target production",
          ),
          p(
            "The command validates the production environment, file permissions, API/Worker keypair, shared secrets, room salt, Worker hostname, public API URL, Cloudflare token, and pinned local Wrangler installation. Every real deployment first performs a Wrangler dry run and then lists deployments to verify the remote result.",
          ),
          note(
            "Explicit production action",
            "Worker deployment is never coupled to server up or production Compose. The production target is required on the command line so local use and CI logs clearly show the external mutation.",
            "warning",
          ),
        ],
      },
    ],
  },
  {
    path: "/server/r2",
    title: "misty-cli server r2 configure-cors",
    eyebrow: "Server",
    description:
      "Preview and apply Misty’s narrow Cloudflare R2 browser-upload CORS policy.",
    command: "misty-cli server r2 configure-cors [--apply]",
    sections: [
      {
        id: "requirements",
        title: "Required environment",
        blocks: [
          code(
            "R2_BUCKET=misty-server\nMISTY_R2_ALLOWED_ORIGINS=https://mistysys.com,tauri://localhost",
            ".env",
          ),
          table(
            ["Variable", "Description"],
            [
              ["R2_BUCKET", "Exact Cloudflare R2 bucket name."],
              ["MISTY_R2_ALLOWED_ORIGINS", "Unique comma-separated origins."],
            ],
          ),
        ],
      },
      {
        id: "dry-run",
        title: "Preview first",
        blocks: [
          code("misty-cli server r2 configure-cors"),
          p(
            "The default is a dry run. It validates the environment and origins, prints the exact JSON policy, and names the bucket without changing Cloudflare.",
          ),
        ],
      },
      {
        id: "apply",
        title: "Apply to Cloudflare",
        blocks: [
          code("misty-cli server r2 configure-cors --apply"),
          p(
            "The command writes the validated policy to a temporary file, invokes the journal-collab Worker’s local Wrangler binary with r2 bucket cors set --force, and then lists the installed policy.",
          ),
          note(
            "Remote mutation",
            "--apply replaces the bucket CORS policy. Confirm the dry-run output and Cloudflare credentials before applying.",
            "warning",
          ),
        ],
      },
      {
        id: "policy",
        title: "Installed policy",
        blocks: [
          table(
            ["Field", "Values"],
            [
              ["Methods", "GET, HEAD, PUT"],
              [
                "Allowed headers",
                "content-type, x-amz-checksum-sha256, x-amz-meta-misty-library-sha256",
              ],
              ["Exposed headers", "etag, x-amz-checksum-sha256"],
              ["Max age", "3600 seconds"],
            ],
          ),
        ],
      },
      {
        id: "origin-validation",
        title: "Origin validation",
        blocks: [
          list([
            "Duplicate origins are rejected instead of silently accepted.",
            "Wildcard origins are forbidden.",
            "Production origins must use HTTPS.",
            "Approved development forms are tauri://localhost and HTTP localhost, 127.0.0.1, or tauri.localhost.",
            "Credentials, paths, query strings, and fragments are forbidden.",
          ]),
          code(
            "# Accepted\nhttps://mistysys.com\ntauri://localhost\nhttp://localhost:5173\n\n# Rejected\nhttps://*.mistysys.com\nhttps://mistysys.com/uploads\nhttp://mistysys.com",
            "Origins",
          ),
        ],
      },
    ],
  },
];
