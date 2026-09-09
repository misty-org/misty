use std::{
    env, fs,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, TcpListener, TcpStream},
    path::Path,
    thread,
    time::{Duration, Instant},
};

use anyhow::{bail, Context, Result};
use clap::ValueEnum;
use serde_json::json;

use crate::{
    process::{command_exists, npm, CommandSpec},
    server,
    workspace::Workspace,
};

const IOS_RUST_TARGETS: [&str; 2] = ["aarch64-apple-ios", "aarch64-apple-ios-sim"];
const APPLE_XCODEPROJ: &str = "src-tauri/gen/apple/misty-native.xcodeproj";
const APPLE_PROJECT: &str = "src-tauri/gen/apple/misty-native.xcodeproj/project.pbxproj";
const APPLE_SCHEME: &str = "misty-native_iOS";
const DEFAULT_MOBILE_DEV_PORT: u16 = 5173;
const MOBILE_BUNDLE_ID: &str = "com.misty.mobile";

#[derive(Debug, Clone, Copy, ValueEnum)]
pub enum BuildTarget {
    /// A physical iPhone or iPad.
    Device,
    /// An Apple-silicon iPhone or iPad simulator.
    Simulator,
    /// An Intel iPhone or iPad simulator.
    IntelSimulator,
}

impl BuildTarget {
    fn tauri_name(self) -> &'static str {
        match self {
            Self::Device => "aarch64",
            Self::Simulator => "aarch64-sim",
            Self::IntelSimulator => "x86_64",
        }
    }

    fn output_dir_name(self) -> &'static str {
        match self {
            Self::Device => "arm64",
            Self::Simulator => "arm64-sim",
            Self::IntelSimulator => "x86_64",
        }
    }

    fn is_device(self) -> bool {
        matches!(self, Self::Device)
    }
}

#[derive(Debug, Clone, Copy, ValueEnum)]
pub enum ExportMethod {
    AppStoreConnect,
    ReleaseTesting,
    Debugging,
}

impl ExportMethod {
    fn tauri_name(self) -> &'static str {
        match self {
            Self::AppStoreConnect => "app-store-connect",
            Self::ReleaseTesting => "release-testing",
            Self::Debugging => "debugging",
        }
    }
}

pub struct DevOptions<'a> {
    pub device: Option<&'a str>,
    pub open: bool,
    pub host: Option<&'a str>,
    pub release: bool,
    pub no_watch: bool,
}

pub struct RunOptions<'a> {
    pub device: Option<&'a str>,
    pub open: bool,
    pub release: bool,
    pub no_watch: bool,
}

pub struct BuildOptions<'a> {
    pub target: BuildTarget,
    pub debug: bool,
    pub open: bool,
    pub no_sign: bool,
    pub build_number: Option<&'a str>,
    pub export_method: Option<ExportMethod>,
    pub ci: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AppleDeviceKind {
    Physical,
    Simulator,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AppleDevice {
    name: String,
    id: Option<String>,
    kind: AppleDeviceKind,
}

pub fn doctor(workspace: &Workspace) -> Result<()> {
    require_macos()?;
    workspace.validate()?;
    for command in ["xcodebuild", "xcrun", "rustup", npm()] {
        if !command_exists(command) {
            bail!("{command} is required for Misty mobile development");
        }
        println!("{command:<18} ready");
    }
    for relative in [
        "src-tauri/tauri.ios.conf.json",
        "src-tauri/gen/apple/project.yml",
        APPLE_PROJECT,
    ] {
        require_file(&workspace.misty.join(relative), relative)?;
    }
    let team = configured_development_team(workspace)?;
    CommandSpec::new("xcodebuild")
        .arg("-version")
        .run(&workspace.misty)?;
    CommandSpec::new(npm())
        .args(["run", "tauri", "--", "--version"])
        .run(&workspace.misty)?;

    let installed = CommandSpec::new("rustup")
        .args(["target", "list", "--installed"])
        .env_remove("RUSTUP_TOOLCHAIN")
        .capture(&workspace.misty)?;
    let missing = IOS_RUST_TARGETS
        .iter()
        .filter(|target| !installed.lines().any(|line| line.trim() == **target))
        .copied()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        bail!(
            "missing Rust iOS targets: {}; run `misty mobile setup` to install them",
            missing.join(", ")
        );
    }
    println!("Rust iOS targets   ready");
    println!("Apple project      ready (team {team})");

    if let Ok(output) = CommandSpec::new("xcrun")
        .args(["devicectl", "list", "devices"])
        .capture(&workspace.misty)
    {
        let available: Vec<_> = output
            .lines()
            .filter(|line| line.contains("available"))
            .collect();
        if !available.is_empty() {
            println!("Connected devices  ready");
            for line in available {
                println!("  {}", line.trim());
            }
        }
    }

    Ok(())
}

pub fn open(workspace: &Workspace) -> Result<()> {
    require_macos()?;
    let project = workspace.misty.join(APPLE_XCODEPROJ);
    if !project.exists() {
        bail!(
            "Apple project was not found at {}; run `misty mobile setup` to initialize it",
            project.display()
        );
    }
    println!("Opening {} in Xcode...", project.display());
    CommandSpec::new("open").arg(&project).run(&workspace.misty)
}

pub fn devices(workspace: &Workspace) -> Result<()> {
    require_macos()?;
    CommandSpec::new("xcodebuild")
        .args([
            "-project",
            APPLE_XCODEPROJ,
            "-scheme",
            APPLE_SCHEME,
            "-showdestinations",
        ])
        .run(&workspace.misty)
}

pub fn setup(
    workspace: &Workspace,
    reinstall_deps: bool,
    skip_targets_install: bool,
) -> Result<()> {
    require_macos()?;
    if !skip_targets_install {
        CommandSpec::new("rustup")
            .args(["target", "add"])
            .args(IOS_RUST_TARGETS)
            .env_remove("RUSTUP_TOOLCHAIN")
            .run(&workspace.misty)?;
    }

    let project = workspace.misty.join(APPLE_PROJECT);
    if project.is_file() && !reinstall_deps {
        println!("Apple project      already initialized");
        return Ok(());
    }

    let mut command = tauri_ios("init");
    if reinstall_deps {
        command = command.arg("--reinstall-deps");
    }
    // Targets were installed explicitly above or deliberately skipped.
    command = command.arg("--skip-targets-install");
    command.run(&workspace.misty)
}

pub fn dev(workspace: &Workspace, options: DevOptions<'_>) -> Result<()> {
    require_macos()?;
    validate_device(options.device)?;
    validate_host(options.host)?;
    let device = resolve_requested_device(workspace, options.device)?;
    let physical_device = device
        .as_ref()
        .is_some_and(|device| device.kind == AppleDeviceKind::Physical);
    let detected_host = if options.host.is_none() && physical_device {
        Some(detect_lan_host(workspace)?)
    } else {
        None
    };
    let host = options
        .host
        .map(str::to_owned)
        .or_else(|| detected_host.map(|host| host.to_string()));

    if let Some(device) = device.as_ref() {
        if device.kind == AppleDeviceKind::Physical {
            ensure_physical_device_is_unlocked(device, workspace)?;
        }
    }

    server::up(workspace, true, false)?;

    let port = available_mobile_port(
        env::var("MISTY_MOBILE_DEV_PORT")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(DEFAULT_MOBILE_DEV_PORT),
    )?;

    let temporary = tempfile::Builder::new()
        .prefix("misty-mobile-dev-")
        .tempdir()?;
    let config_path = temporary.path().join("tauri.mobile.dev.conf.json");
    fs::write(
        &config_path,
        serde_json::to_vec_pretty(&mobile_dev_config(port))?,
    )?;

    if let (Some(device), Some(host)) = (device.as_ref(), host.as_deref()) {
        println!(
            "Starting Misty on {} with hot reload at http://{host}:{port}",
            device.name
        );
    }

    if let (Some(device), Some(host)) = (device.as_ref(), host.as_deref()) {
        if device.kind == AppleDeviceKind::Physical {
            launch_physical_device_when_ready(workspace, device, host, port, options.release)?;
            return with_official_app_development_assets(
                dev_command(
                    DevOptions {
                        device: None,
                        open: true,
                        host: Some(host),
                        ..options
                    },
                    false,
                    Some(&config_path),
                ),
                workspace,
            )
            .run(&workspace.misty);
        }
    }

    with_official_app_development_assets(
        dev_command(
            DevOptions {
                device: device.as_ref().map(|device| device.name.as_str()),
                host: host.as_deref(),
                ..options
            },
            physical_device,
            Some(&config_path),
        ),
        workspace,
    )
    .run(&workspace.misty)
}

pub fn run(workspace: &Workspace, options: RunOptions<'_>) -> Result<()> {
    require_macos()?;
    validate_device(options.device)?;
    let device = resolve_requested_device(workspace, options.device)?;
    if let Some(device) = device.as_ref() {
        if device.kind == AppleDeviceKind::Physical {
            ensure_physical_device_is_unlocked(device, workspace)?;
        }
    }
    run_command(RunOptions {
        device: device.as_ref().map(|device| device.name.as_str()),
        ..options
    })
    .run(&workspace.misty)
}

pub fn build(workspace: &Workspace, options: BuildOptions<'_>) -> Result<()> {
    require_macos()?;
    validate_build_number(options.build_number)?;
    if options.export_method.is_some() && !options.target.is_device() {
        bail!("signed exports require --target device");
    }
    if options.export_method.is_some() && options.no_sign {
        bail!("--export-method cannot be combined with --no-sign");
    }

    // Clean prior build output for this target so Tauri's internal rename does
    // not fail with "Directory not empty (os error 66)".
    let build_root = workspace.misty.join("src-tauri/gen/apple/build");
    for name in [
        options.target.output_dir_name(),
        options.target.tauri_name(),
    ] {
        let dir = build_root.join(name);
        if dir.exists() {
            fs::remove_dir_all(&dir).with_context(|| {
                format!(
                    "could not remove previous build output at {}",
                    dir.display()
                )
            })?;
        }
    }
    let archive_dir = workspace
        .misty
        .join("src-tauri/gen/apple/build/misty-native_iOS.xcarchive");
    if archive_dir.exists() {
        fs::remove_dir_all(&archive_dir).with_context(|| {
            format!(
                "could not remove previous archive at {}",
                archive_dir.display()
            )
        })?;
    }

    build_command(options).run(&workspace.misty)
}

fn tauri_ios(command: &str) -> CommandSpec {
    CommandSpec::new(npm()).args(["run", "tauri", "--", "ios", command])
}

fn dev_command(
    options: DevOptions<'_>,
    physical_device: bool,
    config_path: Option<&Path>,
) -> CommandSpec {
    let mut command = tauri_ios("dev");
    let prompt_for_host = options.host.is_none() && (options.open || physical_device);
    if let Some(config_path) = config_path {
        command = command.arg("--config").arg(config_path.as_os_str());
    }
    if options.open {
        command = command.arg("--open");
    }
    if let Some(host) = options.host {
        command = command.arg(format!("--host={host}"));
    }
    if options.release {
        command = command.arg("--release");
    }
    if options.no_watch {
        command = command.arg("--no-watch");
    }
    if let Some(device) = options.device {
        command = command.arg(device);
    }
    if prompt_for_host {
        // Keep this last so clap cannot interpret a positional device name as
        // the optional value for --host.
        command = command.arg("--host");
    }
    command
}

fn with_official_app_development_assets(
    command: CommandSpec,
    workspace: &Workspace,
) -> CommandSpec {
    command
        .env(
            "MISTY_OFFICIAL_APPS_DIR",
            workspace.extensions.join("public/official-apps"),
        )
        .env(
            "MISTY_OFFICIAL_APPS_CATALOG",
            workspace.extensions.join("apps/catalog.json"),
        )
}

fn mobile_dev_config(port: u16) -> serde_json::Value {
    json!({
        "build": {
            "devUrl": format!("http://127.0.0.1:{port}"),
            "beforeDevCommand": format!(
                "npm run dev:mobile -- --port {port} --strictPort"
            )
        }
    })
}

fn available_mobile_port(start: u16) -> Result<u16> {
    for port in start..=start.saturating_add(49) {
        let ipv4_in_use = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).is_ok();
        let ipv6_in_use = TcpStream::connect((Ipv6Addr::LOCALHOST, port)).is_ok();
        let ipv4_available = TcpListener::bind((Ipv4Addr::UNSPECIFIED, port)).is_ok();
        let ipv6_available = TcpListener::bind(("::", port)).is_ok();
        if !ipv4_in_use && !ipv6_in_use && ipv4_available && ipv6_available {
            return Ok(port);
        }
    }
    bail!("no available mobile dev port found from {start}")
}

fn detect_lan_host(workspace: &Workspace) -> Result<IpAddr> {
    let route = CommandSpec::new("route")
        .args(["-n", "get", "default"])
        .capture(&workspace.misty)
        .context("could not determine the Mac's default network interface; use --host <IP>")?;
    let interface = default_route_interface(&route)
        .context("could not determine the Mac's default network interface; use --host <IP>")?;
    let address = CommandSpec::new("ipconfig")
        .args(["getifaddr", interface])
        .capture(&workspace.misty)
        .with_context(|| format!("could not find an address for {interface}; use --host <IP>"))?;
    let host = address
        .trim()
        .parse::<IpAddr>()
        .with_context(|| format!("invalid address returned for {interface}; use --host <IP>"))?;
    if host.is_loopback() || host.is_unspecified() {
        bail!("the detected address {host} is not reachable from an iPhone; use --host <IP>");
    }
    Ok(host)
}

fn default_route_interface(route: &str) -> Option<&str> {
    route.lines().find_map(|line| {
        let (label, value) = line.split_once(':')?;
        (label.trim() == "interface").then(|| value.trim())
    })
}

fn run_command(options: RunOptions<'_>) -> CommandSpec {
    let mut command = tauri_ios("run");
    if options.open {
        command = command.arg("--open");
    }
    if options.release {
        command = command.arg("--release");
    }
    if options.no_watch {
        command = command.arg("--no-watch");
    }
    if let Some(device) = options.device {
        command = command.arg(device);
    }
    command
}

fn build_command(options: BuildOptions<'_>) -> CommandSpec {
    let mut command = tauri_ios("build").arg(format!("--target={}", options.target.tauri_name()));
    if options.debug {
        command = command.arg("--debug");
    }
    if options.open {
        command = command.arg("--open");
    }
    if options.no_sign {
        command = command.arg("--no-sign");
    }
    if let Some(build_number) = options.build_number {
        command = command.arg("--build-number").arg(build_number);
    }
    if let Some(export_method) = options.export_method {
        command = command.arg(format!("--export-method={}", export_method.tauri_name()));
    }
    if options.ci {
        command = command.arg("--ci");
    }
    command
}

fn require_macos() -> Result<()> {
    if !cfg!(target_os = "macos") {
        bail!("Misty's Apple mobile commands require macOS with Xcode");
    }
    Ok(())
}

fn require_file(path: &Path, label: &str) -> Result<()> {
    if !path.is_file() {
        bail!("{label} was not found at {}", path.display());
    }
    Ok(())
}

fn configured_development_team(workspace: &Workspace) -> Result<String> {
    let definition_path = workspace.misty.join("src-tauri/gen/apple/project.yml");
    let definition = fs::read_to_string(&definition_path)
        .with_context(|| format!("could not read {}", definition_path.display()))?;
    let team_pattern = regex::Regex::new(r#"(?m)^\s+DEVELOPMENT_TEAM:\s*["']?([A-Z0-9]{10})"#)?;
    let team = team_pattern
        .captures(&definition)
        .and_then(|captures| captures.get(1))
        .map(|value| value.as_str().to_owned())
        .context(
            "the Apple project has no development team; set DEVELOPMENT_TEAM in src-tauri/gen/apple/project.yml",
        )?;

    let generated_path = workspace.misty.join(APPLE_PROJECT);
    let generated = fs::read_to_string(&generated_path)
        .with_context(|| format!("could not read {}", generated_path.display()))?;
    let generated_team_pattern = regex::Regex::new(&format!(
        r#"DEVELOPMENT_TEAM\s*=\s*[\"']?{}[\"']?;"#,
        regex::escape(&team)
    ))?;
    if !generated_team_pattern.is_match(&generated) {
        bail!(
            "the generated Xcode project does not contain development team {team}; regenerate or update the Apple project"
        );
    }
    Ok(team)
}

fn validate_device(device: Option<&str>) -> Result<()> {
    if let Some(device) = device {
        let device = device.trim();
        if device.is_empty() || device.chars().any(char::is_control) {
            bail!("device must be a non-empty Xcode device name");
        }
    }
    Ok(())
}

fn validate_host(host: Option<&str>) -> Result<()> {
    if let Some(host) = host {
        host.parse::<IpAddr>()
            .with_context(|| format!("mobile host must be an IP address, got {host}"))?;
    }
    Ok(())
}

fn validate_build_number(build_number: Option<&str>) -> Result<()> {
    if let Some(build_number) = build_number {
        let valid = !build_number.is_empty()
            && build_number.split('.').all(|part| {
                !part.is_empty() && part.chars().all(|character| character.is_ascii_digit())
            });
        if !valid {
            bail!("build number must contain digits separated by periods");
        }
    }
    Ok(())
}

fn resolve_requested_device(
    workspace: &Workspace,
    requested: Option<&str>,
) -> Result<Option<AppleDevice>> {
    let Some(requested) = requested else {
        return Ok(None);
    };
    let listing = CommandSpec::new("xcodebuild")
        .args([
            "-project",
            APPLE_XCODEPROJ,
            "-scheme",
            APPLE_SCHEME,
            "-showdestinations",
        ])
        .capture(&workspace.misty)?;
    resolve_device_from_listing(requested, &listing).map(Some)
}

fn resolve_device_from_listing(requested: &str, listing: &str) -> Result<AppleDevice> {
    let requested_key = normalize_device_name(requested);
    let mut available_names = Vec::new();

    for line in listing.lines() {
        let line = line.trim();
        let kind = if line.contains("platform:iOS Simulator") {
            AppleDeviceKind::Simulator
        } else if line.contains("platform:iOS") {
            AppleDeviceKind::Physical
        } else {
            continue;
        };
        if line.contains("placeholder") {
            continue;
        }
        let id = line.split(',').find_map(|part| {
            let (key, value) = part.trim().split_once(':')?;
            (key.trim() == "id").then(|| value.trim().to_owned())
        });
        let Some((_metadata, name)) = line.rsplit_once("name:") else {
            continue;
        };
        let name = name.trim().trim_end_matches('}').trim();
        available_names.push(name.to_owned());
        if normalize_device_name(name) != requested_key {
            continue;
        }
        return Ok(AppleDevice {
            name: name.to_owned(),
            id,
            kind,
        });
    }

    if available_names.is_empty() {
        bail!("could not find an available iPhone, iPad, or simulator named {requested:?}");
    }
    bail!(
        "could not find an available device named {requested:?}. Available devices: {}",
        available_names.join(", ")
    )
}

fn ensure_physical_device_is_unlocked(device: &AppleDevice, workspace: &Workspace) -> Result<()> {
    let Some(id) = &device.id else {
        return Ok(());
    };
    if let Ok(output) = CommandSpec::new("xcrun")
        .args(["devicectl", "device", "info", "lockState", "--device", id])
        .capture(&workspace.misty)
    {
        if output.contains("passcodeRequired: true") {
            bail!(
                "{} is locked. Unlock the iPhone screen, keep it awake, and run the command again",
                device.name
            );
        }
    }
    Ok(())
}

fn launch_physical_device_when_ready(
    workspace: &Workspace,
    device: &AppleDevice,
    host: &str,
    port: u16,
    release: bool,
) -> Result<()> {
    let device_id = device
        .id
        .clone()
        .context("the selected iPhone did not include an Xcode device identifier")?;
    let device_name = device.name.clone();
    let misty_root = workspace.misty.clone();
    let host = host.to_owned();
    thread::spawn(move || {
        if let Err(error) = build_install_and_launch_physical_device(
            &misty_root,
            &device_id,
            &device_name,
            &host,
            port,
            release,
        ) {
            eprintln!("\nCould not launch Misty on {device_name}: {error:#}\n");
        }
    });
    Ok(())
}

fn build_install_and_launch_physical_device(
    misty_root: &Path,
    device_id: &str,
    device_name: &str,
    host: &str,
    port: u16,
    release: bool,
) -> Result<()> {
    wait_for_mobile_dev_server(port)?;
    let configuration = if release { "Release" } else { "Debug" };
    let product_directory = if release {
        "release-iphoneos"
    } else {
        "debug-iphoneos"
    };
    let derived_data = "src-tauri/gen/apple/DerivedData";
    println!("Building Misty for {device_name}...");
    CommandSpec::new("xcodebuild")
        .args([
            "-project",
            APPLE_XCODEPROJ,
            "-scheme",
            APPLE_SCHEME,
            "-configuration",
            configuration,
            "-destination",
        ])
        .arg(format!("id={device_id}"))
        .args(["-derivedDataPath", derived_data, "build"])
        .env("TAURI_DEV_HOST", host)
        .run(misty_root)?;

    let app = misty_root
        .join(derived_data)
        .join("Build/Products")
        .join(product_directory)
        .join("Misty.app");
    println!("Installing Misty on {device_name}...");
    CommandSpec::new("xcrun")
        .args(["devicectl", "device", "install", "app", "--device"])
        .arg(device_id)
        .arg(app.as_os_str())
        .run(misty_root)?;
    CommandSpec::new("xcrun")
        .args([
            "devicectl",
            "device",
            "process",
            "launch",
            "--terminate-existing",
            "--device",
        ])
        .arg(device_id)
        .arg(MOBILE_BUNDLE_ID)
        .run(misty_root)?;
    println!("Misty is running on {device_name}.");
    Ok(())
}

fn wait_for_mobile_dev_server(port: u16) -> Result<()> {
    let started = Instant::now();
    let timeout = Duration::from_secs(60);
    while started.elapsed() < timeout {
        if TcpStream::connect((Ipv4Addr::LOCALHOST, port)).is_ok() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(200));
    }
    bail!("mobile development server did not start on port {port} within 60 seconds")
}

fn normalize_device_name(value: &str) -> String {
    value
        .chars()
        .map(|character| match character {
            '\u{2018}' | '\u{2019}' | '\u{02bc}' => '\'',
            _ => character,
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_xcode_with_a_network_aware_development_url() {
        let command = dev_command(
            DevOptions {
                device: None,
                open: true,
                host: None,
                release: false,
                no_watch: false,
            },
            false,
            None,
        );
        assert_eq!(command.display(), "npm run tauri -- ios dev --open --host");
    }

    #[test]
    fn sends_a_named_device_after_all_tauri_options() {
        let command = dev_command(
            DevOptions {
                device: Some("Matthew's iPhone"),
                open: false,
                host: Some("192.168.1.20"),
                release: true,
                no_watch: true,
            },
            true,
            None,
        );
        assert_eq!(
            command.display(),
            "npm run tauri -- ios dev --host=192.168.1.20 --release --no-watch \"Matthew's iPhone\""
        );
    }

    #[test]
    fn maps_readable_build_targets_to_tauri_architectures() {
        let command = build_command(BuildOptions {
            target: BuildTarget::Simulator,
            debug: true,
            open: false,
            no_sign: true,
            build_number: None,
            export_method: None,
            ci: false,
        });
        assert_eq!(
            command.display(),
            "npm run tauri -- ios build --target=aarch64-sim --debug --no-sign"
        );
    }

    #[test]
    fn validates_mobile_input_values() {
        assert!(validate_device(Some("Matthew's iPhone")).is_ok());
        assert!(validate_device(Some("\n")).is_err());
        assert!(validate_host(Some("192.168.1.20")).is_ok());
        assert!(validate_host(Some("misty.local")).is_err());
        assert!(validate_build_number(Some("42.1")).is_ok());
        assert!(validate_build_number(Some("42-beta")).is_err());
    }

    #[test]
    fn resolves_smart_apostrophes_from_xcode_destinations() {
        let destinations = r#"
            { platform:iOS, arch:arm64, id:DEVICE-ID, name:Matthew’s iPhone }
            { platform:iOS Simulator, arch:arm64, id:SIM-ID, OS:26.5, name:iPhone 17 }
        "#;
        let device = resolve_device_from_listing("Matthew's iPhone", destinations).unwrap();
        assert_eq!(device.name, "Matthew’s iPhone");
        assert_eq!(device.id.as_deref(), Some("DEVICE-ID"));
        assert_eq!(device.kind, AppleDeviceKind::Physical);

        let simulator = resolve_device_from_listing("iPhone 17", destinations).unwrap();
        assert_eq!(simulator.id.as_deref(), Some("SIM-ID"));
        assert_eq!(simulator.kind, AppleDeviceKind::Simulator);
    }

    #[test]
    fn physical_devices_automatically_use_a_public_host() {
        let command = dev_command(
            DevOptions {
                device: Some("Matthew’s iPhone"),
                open: false,
                host: None,
                release: false,
                no_watch: false,
            },
            true,
            None,
        );
        assert_eq!(
            command.display(),
            "npm run tauri -- ios dev \"Matthew’s iPhone\" --host"
        );
    }

    #[test]
    fn configures_one_matching_port_for_tauri_and_vite() {
        let config = mobile_dev_config(5182);
        assert_eq!(config["build"]["devUrl"], "http://127.0.0.1:5182");
        assert_eq!(
            config["build"]["beforeDevCommand"],
            "npm run dev:mobile -- --port 5182 --strictPort"
        );
    }

    #[test]
    fn skips_a_port_already_used_by_another_dev_server() {
        let occupied = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let occupied_port = occupied.local_addr().unwrap().port();
        let selected_port = available_mobile_port(occupied_port).unwrap();
        assert_ne!(selected_port, occupied_port);
    }

    #[test]
    fn reads_the_default_network_interface() {
        let route = r#"
           route to: default
        destination: default
          interface: en0
        "#;
        assert_eq!(default_route_interface(route), Some("en0"));
        assert_eq!(default_route_interface("route to: default"), None);
    }

    #[test]
    fn requires_the_team_in_both_apple_project_files() {
        let temporary = tempfile::tempdir().unwrap();
        let misty = temporary.path().join("misty");
        let cli = temporary.path().join("misty-cli");
        let definition = misty.join("src-tauri/gen/apple/project.yml");
        let generated = misty.join(APPLE_PROJECT);
        fs::create_dir_all(definition.parent().unwrap()).unwrap();
        fs::create_dir_all(generated.parent().unwrap()).unwrap();
        fs::create_dir_all(&cli).unwrap();
        fs::write(&definition, "    DEVELOPMENT_TEAM: 7D6BVN4W87\n").unwrap();
        fs::write(&generated, "DEVELOPMENT_TEAM = 7D6BVN4W87;\n").unwrap();
        let workspace = Workspace {
            root: temporary.path().to_path_buf(),
            misty,
            server: temporary.path().join("misty-server"),
            website: temporary.path().join("misty-website"),
            extensions: temporary.path().join("misty-store"),
            cli,
        };

        assert_eq!(
            configured_development_team(&workspace).unwrap(),
            "7D6BVN4W87"
        );
        fs::write(&generated, "DEVELOPMENT_TEAM = \"7D6BVN4W87\";\n").unwrap();
        assert_eq!(
            configured_development_team(&workspace).unwrap(),
            "7D6BVN4W87"
        );
        fs::write(&generated, "").unwrap();
        assert!(configured_development_team(&workspace).is_err());
    }
}
