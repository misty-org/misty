[CmdletBinding()]
param(
    [ValidateSet("nsis", "msi", "both")]
    [string]$Bundle = "nsis",
    [string]$AssetSource,
    [switch]$SkipDependencies,
    [switch]$SkipAssets
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($PSVersionTable.PSEdition -eq "Core" -and -not $IsWindows) {
    throw "This script must run on Windows. Use a Windows VM or Windows CI runner."
}

$appDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$serviceLibDir = Join-Path $appDir "src-tauri\target\misty-service\host"

function Assert-Command {
    param([Parameter(Mandatory = $true)][string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Missing required command '$Name'. See docs/windows-build.md for the Windows prerequisites."
    }
}

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
    )
    Write-Host "> $Command $($Arguments -join ' ')" -ForegroundColor Cyan
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command exited with code $LASTEXITCODE."
    }
}

function Resolve-AssetSource {
    if ($AssetSource) {
        return (Resolve-Path $AssetSource).Path
    }

    $staged = Join-Path $appDir ".windows-test\.misty\assets"
    if (Test-Path $staged -PathType Container) {
        return (Resolve-Path $staged).Path
    }

    $existing = Join-Path $HOME ".misty\assets"
    if (Test-Path $existing -PathType Container) {
        return (Resolve-Path $existing).Path
    }

    throw "No test assets found. On the source machine run 'npm run windows:stage-assets', then copy .windows-test with the repository, or pass -AssetSource."
}

Assert-Command "node"
Assert-Command "npm.cmd"
Assert-Command "cargo"
Assert-Command "rustc"
Assert-Command "go"

Push-Location $appDir
try {
    if (-not $SkipAssets) {
        $source = Resolve-AssetSource
        $destination = Join-Path $HOME ".misty\assets"
        $sourceFull = [IO.Path]::GetFullPath($source).TrimEnd('\')
        $destinationFull = [IO.Path]::GetFullPath($destination).TrimEnd('\')

        if (-not $sourceFull.Equals($destinationFull, [StringComparison]::OrdinalIgnoreCase)) {
            New-Item -ItemType Directory -Force -Path $destination | Out-Null
            Copy-Item -Path (Join-Path $source "*") -Destination $destination -Recurse -Force
            Write-Host "Copied test assets to $destination" -ForegroundColor Green
        } else {
            Write-Host "Using existing test assets at $destination" -ForegroundColor Green
        }
    }

    if (-not $SkipDependencies) {
        Invoke-Checked "npm.cmd" "ci"
    }

    Invoke-Checked "npm.cmd" "run" "service:archive"

    $storageDll = Join-Path $serviceLibDir "misty_service.dll"
    if (-not (Test-Path $storageDll -PathType Leaf)) {
        throw "The embedded storage build did not create $storageDll"
    }

    $env:MISTY_SERVICE_GO_LIB_DIR = $serviceLibDir
    $bundles = if ($Bundle -eq "both") { @("nsis", "msi") } else { @($Bundle) }
    $tauriArguments = @("run", "tauri", "--", "build", "--features=embedded-storage-go", "--bundles") + $bundles
    Invoke-Checked "npm.cmd" @tauriArguments

    $bundleRoot = Join-Path $appDir "src-tauri\target\release\bundle"
    $installers = @()
    if (Test-Path $bundleRoot) {
        $installers = @(Get-ChildItem $bundleRoot -Recurse -File |
            Where-Object { $_.Extension -in @(".exe", ".msi") } |
            Sort-Object FullName)
    }
    if ($installers.Count -eq 0) {
        throw "The build completed but no Windows installer was found under $bundleRoot"
    }

    Write-Host "`nWindows installer build complete:" -ForegroundColor Green
    $installers | ForEach-Object { Write-Host "  $($_.FullName)" }
}
finally {
    Pop-Location
}
