# Windows: runs Kiri's WebView2 code for real (host channel, ACL, camera
# permission hook, editing commands, WebView2's own WebAuthn). Needs Rust
# (rustup, MSVC toolchain) and the WebView2 runtime, as for building Misty.
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File kiri\probes\runtime\run.ps1
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$repo = Resolve-Path (Join-Path $here "..\..\..")
# Resolve with the exact versions Misty ships.
Copy-Item (Join-Path $repo "src-tauri\Cargo.lock") (Join-Path $here "Cargo.lock") -Force
Push-Location $here
try {
    cargo build -q
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & (Join-Path $here "target\debug\kiri-runtime-probe.exe") 2>&1 |
        Select-String -Pattern "KIRI RUNTIME|EVENT|panicked"
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
