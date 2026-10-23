# Known Windows limits

Misty reached parity with macOS on Windows 11 on October 13, 2026 (cross-origin frames for agent
page tools followed on October 20). What remains are the limits below, the parts that have not
been run on a Windows machine, and the checks that keep the two platforms in step.

## Limits

- **Extensions (WebView2):**
  - Manifest V3 only.
  - The toolbar shows the manifest's static icon and title: no dynamic badges.
  - The popup opens as a small floating window, and agents can't inspect it.
  - Buttons without a popup can't run their click action.
  - No `tabs`/`windows` proxy, native messaging, `notifications`, `contextMenus` or permission
    prompts after install. `storage.local` works; account sync of `storage.sync` is macOS-only.
  - Updates take about a second to restart the extension.
- **Pages:**
  - Rounded page corners are clipped with a window region, so their edge isn't anti-aliased.
  - Snap Layouts opens through Win+Z on Windows 11, at the top of the window rather than under the
    button.
- **Browser import:** Chrome 127+ sign-ins use app-bound encryption and can't be imported; the
  import result says so and what to do instead.
- **Release:** a signed release needs the Authenticode certificate and the release secrets; the
  ARM64 installer needs the Visual Studio "MSVC ARM64 build tools" on the build machine.

## Built but not yet run on Windows

- Voice and Memory (`docs/design/voice-memory/BRIEF.md`): WASAPI capture, the hold-to-talk hook,
  dictation insertion, the dictation pill's no-activate behavior, transcribing a tab, and screen
  recording. They compile for `x86_64-pc-windows-msvc` but haven't run on a device.
- The October 13 shell (built and checked on macOS only): top-edge drag and double-click zoom,
  rounded panel corners over WebView2, overlays above native pages, titlebar insets for
  right-side caption buttons, and profile website data folders.

## Checks that need a person

Install, update, turn off and remove a store extension; a desktop task with "ask first" and
Escape mid-task; Snap Layouts, pane dimming and click-to-focus; a download with Cancel; importing
sign-ins from Edge; a signed update from one build to the next; and an uninstall that leaves no
default-browser or launch-on-login entries.

## Keeping it caught up

- Any new `#[cfg(target_os = "macos")]` command needs a Windows branch or a line here.
- `desktop-windows` in `.githooks/checks.sh` keeps the Windows build compiling from any machine.
- Add Windows tests beside macOS ones. Tests that touch real tools use private copies, so they
  never change the person's installation.
