# Windows test build

Misty uses Tauri's NSIS bundler for its default Windows installer. The result is a
current-user `-setup.exe`, so it does not require administrator privileges and installs
under `%LOCALAPPDATA%`. An MSI can also be built for managed/enterprise testing.

## 1. Prepare the current test assets

On the Mac/source machine:

```sh
npm run windows:stage-assets
```

This copies only `~/.misty/assets` into the ignored
`.windows-test/.misty/assets` directory. It intentionally does not copy credentials,
databases, logs, caches, mounts, or the macOS rclone executable. Copy the repository,
including the `.windows-test` directory, to the Windows machine. If using Git to move
the source, transfer `.windows-test` separately because it is intentionally ignored.

## 2. Install Windows build prerequisites

Install these once on a Windows 10/11 x64 machine or VM:

- Node.js LTS
- Rust using `rustup` with the default MSVC toolchain
- Go
- Visual Studio 2022 Build Tools with **Desktop development with C++** and a Windows SDK
- WebView2 Runtime (already present on current Windows 10/11 installations in most cases)

The build script validates the command-line prerequisites and fails with the missing
command. Run it from PowerShell, not from WSL, because the app and installer must be
native Windows builds.

## 3. Build

From the repository root in PowerShell:

```powershell
.\scripts\build-windows.ps1
```

The script installs Node dependencies, copies the staged assets to
`%USERPROFILE%\.misty\assets`, builds the embedded Go storage DLL, and creates the
NSIS installer. Output is under:

```text
src-tauri\target\release\bundle\nsis\
```

Useful options:

```powershell
# Build an MSI instead (requires Windows VBSCRIPT optional feature)
.\scripts\build-windows.ps1 -Bundle msi

# Build both installer formats
.\scripts\build-windows.ps1 -Bundle both

# Reuse node_modules or provide a different asset directory
.\scripts\build-windows.ps1 -SkipDependencies -AssetSource D:\misty-test-assets
```

The platform-specific Tauri configuration bundles `misty_service.dll` next to the
installed executable. The staged assets are only copied onto the build/test machine;
they are not included in a distributable production installer.
