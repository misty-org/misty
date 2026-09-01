import type { DocPage } from "./types";
import { code, list, note, p, table } from "./types";

export const homePages: DocPage[] = [
  {
    path: "/home",
    title: "Misty home",
    eyebrow: "Workspace",
    description:
      "Use one predictable ~/.misty directory on macOS, Linux, and Windows without mixing portable plugin files with device state.",
    sections: [
      {
        id: "layout",
        title: "The boundary",
        blocks: [
          p(
            "The application always uses the .misty directory beneath the user home. Product assets ship inside the application; portable plugin web files can move between devices, while databases, credentials, notes, mounts, caches, logs, and platform binaries cannot.",
          ),
          list([
            "cloud, config, db, notes, mnt, cache, and tmp hold device or account state.",
            "Portable generation copies only approved plugin files.",
            "The desktop application is installed separately for each operating system and architecture.",
            "The CLI stores its own settings and development profiles beneath ~/.misty/cli.",
          ]),
        ],
      },
      {
        id: "workflow",
        title: "Recommended workflow",
        blocks: [
          code(
            "# Initialize this device\nmisty home generate\nmisty home check\n\n# Create a portable seed from an existing installation\nmisty home generate \\\n  --source ~/.misty \\\n  --destination ./portable/.misty",
          ),
          note(
            "Do not sync a live home",
            "Generate a separate seed instead of copying the active ~/.misty directory. Live homes contain credentials, local databases, user attachments, and machine-specific state.",
            "warning",
          ),
        ],
      },
    ],
  },
  {
    path: "/home/generate",
    title: "misty home generate",
    eyebrow: "Workspace",
    description:
      "Create or update a production-safe Misty home without replacing existing files.",
    command: "misty home generate [--destination <PATH>] [--source <PATH>]",
    sections: [
      {
        id: "options",
        title: "Options",
        blocks: [
          table(
            ["Option", "Default", "Description"],
            [
              [
                "--destination <PATH>",
                "~/.misty",
                "Exact directory to initialize.",
              ],
              [
                "--source <PATH>",
                "None",
                "Existing Misty home supplying approved portable plugins.",
              ],
            ],
          ),
          list([
            "Creates the versioned layout and missing default hosted-server configuration.",
            "Uses user-only permissions for the home, configuration, database, and secret-bearing paths.",
            "Preserves every existing file and reports copied versus preserved portable files.",
            "Never copies device state, credentials, notes, mounts, caches, logs, release keys, or platform binaries.",
          ]),
        ],
      },
    ],
  },
  {
    path: "/home/check",
    title: "misty home check",
    eyebrow: "Workspace",
    description:
      "Validate the layout version, permissions, and retired paths without reading values.",
    command: "misty home check [--path <PATH>]",
    sections: [
      {
        id: "checks",
        title: "Checks",
        blocks: [
          list([
            "Required directories and home.json layout version.",
            "User-only permissions on the home and known private files.",
            "Retired runtime assets, rclone, proxy, ImGui, legacy database, profile, release, and template paths.",
          ]),
        ],
      },
    ],
  },
];
