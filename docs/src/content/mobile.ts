import type { DocPage } from "./types";
import { code, list, note, p, table } from "./types";

export const mobilePages: DocPage[] = [
  {
    path: "/mobile",
    title: "Apple mobile commands",
    eyebrow: "Mobile",
    description:
      "Prepare Xcode, find devices, run Misty on iPhone or iPad, and create iOS builds.",
    sections: [
      {
        id: "recommended-loop",
        title: "Recommended first-device loop",
        blocks: [
          code(
            'misty mobile doctor\nmisty mobile devices\nmisty mobile setup\nmisty mobile dev --device "My iPhone"',
          ),
          p(
            "After signing is configured once, the final command prepares the backend, finds the Mac on the local network, builds, installs, and opens Misty on the named device. Paired wireless devices use Apple's CoreDevice path automatically.",
          ),
          note(
            "Tracked project stays intact",
            "mobile setup does not regenerate an existing Apple project unless you explicitly add --reinstall-deps.",
            "success",
          ),
        ],
      },
      {
        id: "commands",
        title: "Available commands",
        blocks: [
          table(
            ["Command", "Purpose"],
            [
              [
                "mobile doctor",
                "Validate the Apple mobile toolchain and tracked project.",
              ],
              [
                "mobile devices",
                "List devices and simulators visible to Xcode.",
              ],
              [
                "mobile open",
                "Open the generated Apple project in Xcode.",
              ],
              [
                "mobile setup",
                "Install Rust iOS targets and initialize the Apple project only when absent.",
              ],
              [
                "mobile dev",
                "Run with the mobile development server and hot reload.",
              ],
              [
                "mobile run",
                "Run the built frontend without the development server.",
              ],
              [
                "mobile build",
                "Build for a device or simulator, with optional signing/export.",
              ],
            ],
          ),
        ],
      },
      {
        id: "requirements",
        title: "Requirements",
        blocks: [
          list([
            "Apple mobile commands run only on macOS with Xcode installed.",
            "A physical iPhone or iPad must be unlocked, trusted, and in Developer Mode.",
            "Xcode needs an Apple account and a selected signing team before a device build can install.",
            "The Mac and device must be able to reach each other for development hot reload.",
          ]),
        ],
      },
    ],
  },
  {
    path: "/mobile/dev",
    title: "misty mobile dev",
    eyebrow: "Mobile",
    description:
      "Run Misty's iOS development build on a device or through Xcode.",
    command:
      "misty mobile dev [--device <NAME>] [--open] [--host <IP>] [--release] [--no-watch]",
    sections: [
      {
        id: "examples",
        title: "Examples",
        blocks: [
          code(
            '# Configure signing and choose a device in Xcode\nmisty mobile dev --open\n\n# Launch one known device directly\nmisty mobile dev --device "My iPhone"\n\n# Pin the development server to a specific Mac address\nmisty mobile dev --device "My iPhone" --host 192.168.1.20',
          ),
          note(
            "Everything starts together",
            "With a named physical device, the CLI refreshes the backend only when needed, discovers the Mac's LAN address, selects a free port, starts Vite and Tauri, installs Misty over USB or Wi-Fi, opens it, and keeps hot reload running. A locked device is rejected immediately with a clear message instead of leaving Xcode waiting.",
            "success",
          ),
        ],
      },
      {
        id: "options",
        title: "Options",
        blocks: [
          table(
            ["Option", "Description"],
            [
              ["--device <NAME>", "Use an exact name from mobile devices."],
              ["--open", "Open Xcode instead of launching a device directly."],
              [
                "--host <IP>",
                "Use a particular local IP for the development server.",
              ],
              ["--release", "Compile the Rust application in release mode."],
              ["--no-watch", "Disable Rust source watching."],
            ],
          ),
        ],
      },
    ],
  },
  {
    path: "/mobile/build",
    title: "misty mobile build",
    eyebrow: "Mobile",
    description:
      "Create an iOS device, simulator, TestFlight, or App Store build.",
    command:
      "misty mobile build [--target <TARGET>] [--debug] [--open] [--no-sign] [--build-number <NUMBER>] [--export-method <METHOD>] [--ci]",
    sections: [
      {
        id: "targets",
        title: "Readable build targets",
        blocks: [
          table(
            ["Target", "Tauri architecture", "Use"],
            [
              ["device", "aarch64", "Physical iPhone or iPad; the default."],
              ["simulator", "aarch64-sim", "Simulator on Apple-silicon Macs."],
              ["intel-simulator", "x86_64", "Simulator on Intel Macs."],
            ],
          ),
          code(
            "# Fast unsigned simulator verification\nmisty mobile build --target simulator --no-sign\n\n# Signed App Store Connect export\nmisty mobile build --build-number 42 --export-method app-store-connect",
          ),
        ],
      },
      {
        id: "guardrails",
        title: "Signing guardrails",
        blocks: [
          list([
            "Signed exports require the device target.",
            "--export-method cannot be combined with --no-sign.",
            "Build numbers accept numeric components separated by periods.",
            "Export methods are app-store-connect, release-testing, and debugging.",
          ]),
        ],
      },
    ],
  },
];
