import type { DocPage } from "./types";
import { code, list, note, p, table } from "./types";

export const releasePages: DocPage[] = [
  {
    path: "/releases",
    title: "Desktop release workflow",
    eyebrow: "Releases",
    badge: "Advanced",
    description:
      "Build the selected macOS and Windows release targets without mixing source or tooling revisions.",
    sections: [
      {
        id: "flow",
        title: "The five-stage flow",
        blocks: [
          code(
            "misty release start 0.2.0\nmisty release build 0.2.0\nmisty release upload 0.2.0\nmisty release verify 0.2.0\nmisty release publish 0.2.0",
          ),
          table(
            ["Stage", "Where", "Outcome"],
            [
              [
                "start",
                "macOS or Windows",
                "Source tag, draft prerelease, release manifest, locked config.",
              ],
              [
                "build",
                "Run once for each selected platform",
                "Signed updater artifacts and platform manifest.",
              ],
              [
                "upload",
                "Same machine that built",
                "Platform files attached to the draft.",
              ],
              [
                "verify",
                "After all selected uploads",
                "All assets checked and latest.json generated.",
              ],
              [
                "publish",
                "Final operator machine",
                "Draft is reduced to the verified public assets, checked again, and published.",
              ],
            ],
          ),
        ],
      },
      {
        id: "identity",
        title: "Release identity",
        blocks: [
          p(
            "release start records the exact Misty app commit, CLI version, normalized app version, and release configuration hash. Later stages refuse to proceed when the checkout or generated configuration differs.",
          ),
          list([
            "The application commit must match on macOS and Windows.",
            "The CLI commit must match on macOS and Windows.",
            "The Misty app working tree must be clean.",
            "package.json, Cargo.toml, and tauri.conf.json must share the release version.",
            "Platform manifests must point to the release tag and approved platform.",
            "Every artifact record contains its filename, SHA-256 digest, and byte length.",
          ]),
        ],
      },
      {
        id: "platforms",
        title: "Published platforms",
        blocks: [
          table(
            ["Platform", "Build", "Primary artifacts"],
            [
              [
                "macos-universal",
                "arm64 + x86_64 in one binary",
                "Signed/notarized DMG and signed updater .app.tar.gz.",
              ],
              [
                "windows-x86_64",
                "x64 NSIS",
                "Signed NSIS installer used by people and the updater.",
              ],
            ],
          ),
          note(
            "Linux",
            "Linux packaging is not part of the current release contract. release build exits with an error on Linux.",
          ),
          note(
            "Platform-only releases",
            "release start includes both platforms by default. Use --no-windows for macOS-only or --no-macos for Windows-only. The choice is recorded in the release manifest and cannot be changed by later stages.",
          ),
        ],
      },
      {
        id: "before-release",
        title: "Before starting",
        blocks: [
          list([
            "Run misty doctor and resolve every release input.",
            "Make all three application version files match the intended semantic version.",
            "Merge the release source to misty/main and synchronize it with origin/main.",
            "Ensure the Misty app repository is clean and synchronized with origin/main.",
            "Authenticate GitHub CLI for the private source and misty-org/misty-public release repository.",
            "On macOS, configure Developer ID signing and an Apple Keychain notarytool profile.",
          ]),
        ],
      },
    ],
  },
  {
    path: "/releases/start",
    title: "misty release start",
    eyebrow: "Releases",
    description:
      "Lock release identity, run desktop checks, create the source tag, and open a draft prerelease.",
    command:
      "misty release start <VERSION> [--dry-run] [--no-macos] [--no-windows]",
    sections: [
      {
        id: "usage",
        title: "Usage",
        blocks: [
          code(
            "misty release start 0.2.0\nmisty release start 0.2.0 --no-windows\nmisty release start 0.2.0 --no-macos\nmisty release start v0.2.0 --dry-run",
          ),
          table(
            ["Argument", "Description"],
            [
              [
                "VERSION",
                "Semantic version such as 0.2.0 or 0.2.0-beta.1. v and misty-v prefixes are normalized.",
              ],
              [
                "--dry-run",
                "Validate and write local release state without checks, fetch, tag, push, or GitHub draft mutation.",
              ],
              [
                "--no-macos",
                "Create a Windows-only release. Cannot be combined with --no-windows.",
              ],
              [
                "--no-windows",
                "Create a macOS-only release. Cannot be combined with --no-macos.",
              ],
            ],
          ),
        ],
      },
      {
        id: "preconditions",
        title: "Preconditions",
        blocks: [
          list([
            "The workspace contains all five Git repositories.",
            "misty/package.json has the requested version.",
            "misty/src-tauri/Cargo.toml has the requested version.",
            "misty/src-tauri/tauri.conf.json has the requested version.",
            "The Misty app repository is on main and clean.",
            "For a real start, local main equals the freshly fetched origin/main.",
            "Every required release configuration value is valid.",
          ]),
        ],
      },
      {
        id: "checks-and-state",
        title: "Checks and local state",
        blocks: [
          p(
            "A real start runs the full misty check app workflow. It then writes release state beneath misty/artifacts/release/<VERSION>/.",
          ),
          table(
            ["File", "Purpose"],
            [
              [
                "tauri.release.conf.json",
                "Validated release-only Tauri security, updater, and signing configuration.",
              ],
              [
                "misty-release-manifest.json",
                "Version, tag, source/CLI commits, CLI version, config hash, timestamp, and selected platforms.",
              ],
            ],
          ),
        ],
      },
      {
        id: "remote-actions",
        title: "Remote actions",
        blocks: [
          list([
            "Creates annotated source tag misty-v<VERSION> unless an identical tag already exists.",
            "Refuses an existing tag that points to a different source commit.",
            "Pushes the tag to the misty origin.",
            "Creates a draft prerelease titled “Misty <VERSION> beta” in misty-org/misty-public, or updates an existing draft.",
            "Uploads misty-release-manifest.json to the draft.",
          ]),
          note(
            "Dry-run nuance",
            "--dry-run does not fetch origin/main or run the full Misty checks, but it still requires the local main branch, clean checkout, matching local origin/main, valid versions, and valid release environment.",
          ),
        ],
      },
    ],
  },
  {
    path: "/releases/build",
    title: "misty release build",
    eyebrow: "Releases",
    description:
      "Build and validate the current platform’s shipping artifacts against the locked release identity.",
    command: "misty release build <VERSION> [--dry-run]",
    sections: [
      {
        id: "usage",
        title: "Usage",
        blocks: [
          code(
            "# Run on the Mac release machine\nmisty release build 0.2.0\n\n# Run from the identical revisions on Windows\nmisty release build 0.2.0",
          ),
        ],
      },
      {
        id: "identity-checks",
        title: "Identity checks",
        blocks: [
          list([
            "Loads the local release manifest, downloading it from the draft when necessary for a real build.",
            "Verifies all three Misty version files.",
            "Requires the current Misty app HEAD to match source_commit.",
            "Requires the Misty checkout to be clean.",
            "Rebuilds the release Tauri configuration and requires its SHA-256 to match config_sha256.",
          ]),
          note(
            "CLI checkout cleanliness",
            "The recorded CLI version must match and the Misty app working tree must be clean. Commit and reinstall misty before starting the release.",
            "warning",
          ),
        ],
      },
      {
        id: "shared-build",
        title: "Shared build steps",
        blocks: [
          list([
            "Runs npm ci in misty.",
            "Runs npm run build:desktop.",
            "Creates the shared bundle report, web CycloneDX SBOM, Rust CycloneDX SBOM, and third-party notices on macOS, or on Windows when macOS is excluded.",
            "Runs Tauri with --ci and the locked release configuration.",
            "Copies selected shipping artifacts into misty/artifacts/release/<VERSION>/<platform>/.",
            "Creates a platform manifest and platform-specific SHA256SUMS file.",
          ]),
        ],
      },
      {
        id: "macos",
        title: "macOS universal build",
        blocks: [
          code(
            "npm run tauri -- build \\\n  --bundles app,dmg \\\n  --target universal-apple-darwin \\\n  --config <release-config> \\\n  --ci",
          ),
          list([
            "Submits the DMG to Apple notarytool using MISTY_NOTARY_KEYCHAIN_PROFILE and waits.",
            "Staples the notarization ticket to both the .app and DMG.",
            "Uses lipo to require arm64 and x86_64 in the application executable.",
            "Runs strict deep codesign verification.",
            "Runs Gatekeeper assessment with spctl.",
            "Validates the DMG’s stapled ticket.",
            "Selects DMG, updater .gz, and .sig artifacts.",
          ]),
        ],
      },
      {
        id: "windows",
        title: "Windows x64 build",
        blocks: [
          list([
            "Runs Tauri’s NSIS bundle build on Windows.",
            "Selects the installer .exe and its updater .sig.",
            "Updater signing is mandatory through Tauri’s signing key.",
            "Authenticode signing is optional and enabled only when WINDOWS_CERTIFICATE_THUMBPRINT and WINDOWS_TIMESTAMP_URL are configured.",
          ]),
        ],
      },
      {
        id: "dry-run",
        title: "Dry run",
        blocks: [
          code("misty release build 0.2.0 --dry-run"),
          p(
            "The dry run verifies manifest identity and release configuration for the current platform, then exits before npm installation, application builds, signing, notarization, and artifact creation.",
          ),
        ],
      },
      {
        id: "budgets",
        title: "Release metadata and budgets",
        blocks: [
          table(
            ["Budget", "Limit"],
            [
              ["Total web bundle", "28 MiB"],
              ["All JavaScript", "19 MiB"],
              ["Largest JavaScript chunk", "2 MiB"],
            ],
          ),
          p(
            "The build responsible for shared metadata fails when a budget is exceeded. Shared metadata also includes production web dependencies, Rust dependencies, and a generated third-party notice table.",
          ),
        ],
      },
    ],
  },
  {
    path: "/releases/upload",
    title: "misty release upload",
    eyebrow: "Releases",
    description:
      "Validate and attach the current platform’s artifacts to the existing draft release.",
    command: "misty release upload <VERSION> [--dry-run]",
    sections: [
      {
        id: "usage",
        title: "Usage",
        blocks: [
          code(
            "# After the Mac build\nmisty release upload 0.2.0\n\n# After the Windows build\nmisty release upload 0.2.0",
          ),
        ],
      },
      {
        id: "validation",
        title: "Validation",
        blocks: [
          list([
            "Loads the release manifest and verifies local Misty and CLI identity.",
            "Selects macos-universal or windows-x86_64 from the current operating system.",
            "Requires release-<platform>.json from a completed build.",
            "Requires version, tag, source commit, CLI commit, and platform to match the release.",
            "Collects every file under the platform directory.",
            "Also includes shared metadata when the shared directory is available.",
          ]),
        ],
      },
      {
        id: "upload",
        title: "Upload behavior",
        blocks: [
          p(
            "A real upload uses gh release upload against misty-org/misty-public with --clobber. Re-running the command replaces draft assets with the same filename.",
          ),
          code("misty release upload 0.2.0 --dry-run"),
          p(
            "The dry run prints every file that would be uploaded and performs no GitHub mutation.",
          ),
          note(
            "Build on the same platform",
            "Upload selects the current operating system’s platform folder. Run it from the platform that produced those artifacts.",
          ),
        ],
      },
    ],
  },
  {
    path: "/releases/verify",
    title: "misty release verify",
    eyebrow: "Releases",
    description:
      "Require every platform selected at release start, validate its artifacts, and generate the static Tauri updater manifest.",
    command: "misty release verify <VERSION> [--dry-run]",
    sections: [
      {
        id: "real-verification",
        title: "Remote verification",
        blocks: [
          code("misty release verify 0.2.0"),
          list([
            "Recreates the local verification directory.",
            "Downloads all assets from the draft release in misty-org/misty-public.",
            "Requires a platform manifest for every platform selected at release start.",
            "Verifies platform identity against the release manifest.",
            "Checks that every recorded file exists with its exact byte length and SHA-256 digest.",
            "Cryptographically verifies every updater payload and signature against Misty's configured Tauri updater public key.",
            "Requires the release manifest, bundle report, both SBOMs, and third-party notices.",
            "Generates latest.json and a combined SHA256SUMS.",
            "Uploads latest.json and SHA256SUMS back to the draft with replacement enabled.",
          ]),
        ],
      },
      {
        id: "updater-mapping",
        title: "Updater platform mapping",
        blocks: [
          table(
            ["Updater key", "Artifact"],
            [
              [
                "darwin-aarch64",
                "Universal macOS updater archive and its signature.",
              ],
              [
                "darwin-x86_64",
                "The same universal macOS updater archive and signature.",
              ],
              [
                "windows-x86_64",
                "Windows NSIS updater executable and its signature.",
              ],
            ],
          ),
          p(
            "latest.json includes only the updater keys selected at release start. It uses GitHub release download URLs under the misty-v<VERSION> tag and includes the current UTC publication timestamp.",
          ),
        ],
      },
      {
        id: "dry-run",
        title: "Dry-run behavior",
        blocks: [
          code("misty release verify 0.2.0 --dry-run"),
          note(
            "Not a mock",
            "The verify dry run requires the selected local platform directories and manifests. It validates local identities, files, hashes, byte lengths, and signatures without downloading or uploading GitHub assets.",
          ),
        ],
      },
    ],
  },
  {
    path: "/releases/publish",
    title: "misty release publish",
    eyebrow: "Releases",
    description:
      "Re-run verification and explicitly convert the draft prerelease into a public prerelease.",
    command: "misty release publish <VERSION> [--yes] [--dry-run]",
    sections: [
      {
        id: "default-flow",
        title: "Confirmed publication",
        blocks: [
          code("misty release publish 0.2.0"),
          p(
            "The command first performs the complete remote verify workflow. It then asks you to type the exact phrase publish 0.2.0. Any other input cancels publication.",
          ),
          code("publish 0.2.0", "Required confirmation"),
          list([
            "Keeps exactly one human installer for each selected platform.",
            "Keeps each signed Tauri updater payload. On Windows the installer is also the updater payload.",
            "Keeps latest.json with the updater signatures embedded in it.",
            "Deletes standalone signatures, checksums, manifests, SBOMs, bundle reports, and notices from the draft release.",
            "Downloads the reduced release and rechecks the exact asset set, SHA-256 digests, byte lengths, and latest.json before publication.",
          ]),
        ],
      },
      {
        id: "yes",
        title: "Non-interactive confirmation",
        blocks: [
          code("misty release publish 0.2.0 --yes"),
          note(
            "Use with care",
            "--yes skips the typed confirmation but does not skip verification. Reserve it for an intentional, controlled non-interactive publication.",
            "danger",
          ),
        ],
      },
      {
        id: "dry-run",
        title: "Dry run",
        blocks: [
          code("misty release publish 0.2.0 --dry-run"),
          p(
            "Dry-run publication runs local verification for the selected platforms through verify --dry-run and then reports that it would publish the tag. It neither downloads assets nor changes the GitHub draft.",
          ),
        ],
      },
      {
        id: "result",
        title: "Result",
        blocks: [
          p(
            "A successful real publication exposes only the installers, updater payloads, and latest.json, then edits misty-v<VERSION> in misty-org/misty-public to set draft=false while retaining prerelease status. GitHub's automatic source archives remain visible because they are not release assets. Publication does not create a production deployment or promote the prerelease to a final release.",
          ),
          note(
            "Edit release notes",
            "release start creates placeholder public-beta notes. Review the draft’s customer-facing notes before publishing.",
            "warning",
          ),
        ],
      },
    ],
  },
];
