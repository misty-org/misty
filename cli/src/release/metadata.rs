use std::{fs, path::Path};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

use crate::{artifacts, process::CommandSpec, workspace::Workspace};

const TOTAL_BUDGET: u64 = 28 * 1024 * 1024;
const JAVASCRIPT_BUDGET: u64 = 19 * 1024 * 1024;
const CHUNK_BUDGET: u64 = 2 * 1024 * 1024;

#[derive(Debug, Serialize)]
struct BundleReport {
    generated_at: String,
    files: usize,
    total_bytes: u64,
    javascript_bytes: u64,
    largest_javascript: Vec<BundleFile>,
    budgets: BundleBudgets,
}

#[derive(Debug, Serialize)]
struct BundleFile {
    file: String,
    bytes: u64,
}

#[derive(Debug, Serialize)]
struct BundleBudgets {
    total_bytes: u64,
    javascript_bytes: u64,
    single_javascript_bytes: u64,
}

#[derive(Debug, Deserialize)]
struct CycloneDx {
    #[serde(default)]
    components: Vec<Component>,
}

#[derive(Debug, Deserialize)]
struct Component {
    name: String,
    #[serde(default)]
    version: String,
    #[serde(default)]
    purl: String,
    #[serde(default)]
    licenses: Vec<LicenseEntry>,
}

#[derive(Debug, Deserialize)]
struct LicenseEntry {
    license: Option<License>,
    expression: Option<String>,
}

#[derive(Debug, Deserialize)]
struct License {
    id: Option<String>,
    name: Option<String>,
}

pub fn generate(workspace: &Workspace, output: &Path) -> Result<()> {
    fs::create_dir_all(output)?;
    bundle_report(&workspace.misty.join("dist"), output)?;
    web_sbom(workspace, output)?;
    rust_sbom(workspace, output)?;
    Ok(())
}

fn bundle_report(dist: &Path, output: &Path) -> Result<()> {
    let files = artifacts::files_under(dist)?;
    let mut javascript = files
        .iter()
        .filter(|path| path.extension().is_some_and(|extension| extension == "js"))
        .map(|path| {
            Ok(BundleFile {
                file: path
                    .strip_prefix(dist)?
                    .to_string_lossy()
                    .replace('\\', "/"),
                bytes: fs::metadata(path)?.len(),
            })
        })
        .collect::<Result<Vec<_>>>()?;
    javascript.sort_by(|left, right| right.bytes.cmp(&left.bytes));
    let total_bytes = files
        .iter()
        .map(fs::metadata)
        .collect::<std::io::Result<Vec<_>>>()?
        .iter()
        .map(fs::Metadata::len)
        .sum();
    let javascript_bytes = javascript.iter().map(|entry| entry.bytes).sum();
    let largest = javascript.first().map_or(0, |entry| entry.bytes);
    let report = BundleReport {
        generated_at: chrono::Utc::now().to_rfc3339(),
        files: files.len(),
        total_bytes,
        javascript_bytes,
        largest_javascript: javascript.into_iter().take(20).collect(),
        budgets: BundleBudgets {
            total_bytes: TOTAL_BUDGET,
            javascript_bytes: JAVASCRIPT_BUDGET,
            single_javascript_bytes: CHUNK_BUDGET,
        },
    };
    fs::write(
        output.join("bundle-size.json"),
        format!("{}\n", serde_json::to_string_pretty(&report)?),
    )?;
    if total_bytes > TOTAL_BUDGET || javascript_bytes > JAVASCRIPT_BUDGET || largest > CHUNK_BUDGET
    {
        bail!("production bundle exceeded its release size budget");
    }
    Ok(())
}

fn web_sbom(workspace: &Workspace, output: &Path) -> Result<()> {
    let binary = workspace
        .misty
        .join("node_modules/.bin")
        .join(if cfg!(windows) {
            "cyclonedx-npm.cmd"
        } else {
            "cyclonedx-npm"
        });
    let sbom = output.join("misty-web.cdx.json");
    CommandSpec::new(binary.as_os_str())
        .args([
            "--package-lock-only",
            "--ignore-npm-errors",
            "--omit",
            "dev",
            "--output-reproducible",
            "--validate",
            "--output-file",
        ])
        .arg(sbom.as_os_str())
        .arg(workspace.misty.join("package.json").as_os_str())
        .run(&workspace.misty)?;
    let mut bom: CycloneDx = serde_json::from_slice(&fs::read(&sbom)?)?;
    bom.components
        .sort_by(|left, right| (&left.name, &left.version).cmp(&(&right.name, &right.version)));
    let mut notices = vec![
        "# Misty third-party software notices".to_owned(),
        String::new(),
        "| Package | Version | License | Package URL |".to_owned(),
        "| --- | --- | --- | --- |".to_owned(),
    ];
    for component in bom.components {
        let licenses = component
            .licenses
            .into_iter()
            .filter_map(|entry| {
                entry
                    .license
                    .and_then(|license| license.id.or(license.name))
                    .or(entry.expression)
            })
            .collect::<Vec<_>>();
        let license_label = if licenses.is_empty() {
            "Not declared".to_owned()
        } else {
            licenses.join(", ")
        };
        notices.push(format!(
            "| {} | {} | {} | {} |",
            escape(&component.name),
            escape(&component.version),
            escape(&license_label),
            escape(&component.purl)
        ));
    }
    fs::write(
        output.join("THIRD_PARTY_NOTICES.md"),
        format!("{}\n", notices.join("\n")),
    )?;
    Ok(())
}

fn rust_sbom(workspace: &Workspace, output: &Path) -> Result<()> {
    CommandSpec::new("cargo")
        .args([
            "cyclonedx",
            "--manifest-path",
            "src-tauri/Cargo.toml",
            "--format",
            "json",
        ])
        .run(&workspace.misty)?;
    let generated = fs::read_dir(workspace.misty.join("src-tauri"))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .find(|path| {
            path.extension()
                .is_some_and(|extension| extension == "json")
                && path
                    .file_name()
                    .is_some_and(|name| name.to_string_lossy().contains(".cdx."))
        })
        .context("cargo cyclonedx did not create a Rust SBOM")?;
    fs::copy(&generated, output.join("misty-rust.cdx.json"))?;
    fs::remove_file(generated)?;
    Ok(())
}

fn escape(value: &str) -> String {
    value.replace('|', "\\|").replace('\n', " ")
}
