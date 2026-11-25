use std::io::Write;

use super::*;

fn spec(url: &str, sha256: &str) -> (McpProgram, Build) {
    let build = Build {
        url: url.to_owned(),
        sha256: sha256.to_owned(),
        size: 10,
    };
    let program = McpProgram {
        program: "demo-cli".into(),
        args: vec!["mcp".into()],
        read_root_flag: "--read-root".into(),
        write_root_flag: "--write-root".into(),
        env: HashMap::new(),
        builds: HashMap::new(),
    };
    (program, build)
}

fn zip_of(files: &[(&str, &[u8])]) -> Vec<u8> {
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for (name, data) in files {
        writer
            .start_file(*name, zip::write::SimpleFileOptions::default())
            .unwrap();
        writer.write_all(data).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

fn tar_gz_of(files: &[(&str, &[u8])]) -> Vec<u8> {
    let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(
        Vec::new(),
        flate2::Compression::fast(),
    ));
    for (name, data) in files {
        let mut header = tar::Header::new_gnu();
        header.set_size(data.len() as u64);
        header.set_mode(0o755);
        header.set_cksum();
        builder.append_data(&mut header, name, *data).unwrap();
    }
    builder.into_inner().unwrap().finish().unwrap()
}

fn temp_root(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("misty-programs-{name}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    root
}

#[test]
fn only_the_program_is_taken_out_of_a_matching_archive() {
    let root = temp_root("install");
    let archive = zip_of(&[
        ("demo/demo-cli", b"#!program"),
        ("demo/README", b"r"),
        ("demo/demo", b"gui"),
    ]);
    let sum = hex::encode(Sha256::digest(&archive));
    let (program, build) = spec(
        "https://github.com/maker/demo/releases/download/v1/demo-cli-1.zip",
        &sum,
    );
    let path = install_in(&root, "demo", "1.0.0", &program, &build, &archive).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), b"#!program");
    assert!(listing_dir(path.parent().unwrap().parent().unwrap()).is_dir());
    assert!(!path.parent().unwrap().join("README").exists());
    let (program, bad) = spec(&build.url, &"0".repeat(64));
    assert!(install_in(&root, "other", "1.0.0", &program, &bad, &archive).is_err());
    assert!(!root.join("other").exists());
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn a_tarball_gives_up_its_program_too_and_two_or_none_are_refused() {
    let archive = tar_gz_of(&[("demo-1/bin/demo-cli", b"elf"), ("demo-1/share/x", b"x")]);
    assert_eq!(from_tar_gz(&archive, "demo-cli").unwrap(), b"elf");
    assert!(from_tar_gz(
        &tar_gz_of(&[("a/demo-cli", b"1"), ("b/demo-cli", b"2")]),
        "demo-cli"
    )
    .is_err());
    assert!(from_tar_gz(&tar_gz_of(&[("a/other", b"1")]), "demo-cli").is_err());
    assert!(from_zip(
        &zip_of(&[("a/demo-cli", b"1"), ("b/demo-cli", b"2")]),
        "demo-cli"
    )
    .is_err());
    assert!(from_zip(&zip_of(&[("a/other", b"1")]), "demo-cli").is_err());
}

#[test]
fn the_pin_comes_from_the_catalog_and_must_be_the_makers_own() {
    let Some(platform) = platform() else { return };
    let catalog = |url: &str, extra: &str| -> String {
        format!(
            r#"[{{"kind":"site","id":"tunes","name":"Tunes"}},{{"id":"demo","upstream":"maker/demo","version":"1.0.0","mcp_program":{{"program":"demo-cli","args":["mcp"],"read_root_flag":"--read-root","write_root_flag":"--write-root"{extra},"builds":{{"{platform}":{{"url":"{url}","sha256":"{}","size":10}}}}}}}}]"#,
            "a".repeat(64)
        )
    };
    let good = catalog(
        "https://github.com/maker/demo/releases/download/v1/demo-cli.zip",
        "",
    );
    let (program, build) = pinned_in(&good, "demo", "1.0.0").unwrap();
    assert_eq!((program.program.as_str(), build.size), ("demo-cli", 10));
    assert!(pinned_in(
        &catalog(
            "https://github.com/someone/else/releases/download/v1/x.zip",
            ""
        ),
        "demo",
        "1.0.0"
    )
    .is_err());
    assert!(pinned_in(
        &catalog(
            "https://github.com/maker/demo/releases/download/v1/x.dmg",
            ""
        ),
        "demo",
        "1.0.0"
    )
    .is_err());
    let env = catalog(
        "https://github.com/maker/demo/releases/download/v1/demo-cli.zip",
        r#","env":{"DYLD_INSERT_LIBRARIES":"/x"}"#,
    );
    assert!(pinned_in(&env, "demo", "1.0.0").is_err());
    assert!(pinned_in(&good, "demo", "2.0.0").is_err());
    assert!(pinned_in(&good, "nothing", "1.0.0").is_err());
}

#[test]
fn flags_and_variables_are_checked() {
    assert!(
        flag_ok("--automation-read-root")
            && !flag_ok("-r")
            && !flag_ok("--Root")
            && !flag_ok("--a b")
    );
    assert!(env_ok("SOUNDCRAFT_NO_PREFS", "1"));
    assert!(
        !env_ok("PATH", "/x")
            && !env_ok("LD_PRELOAD", "x")
            && !env_ok("DYLD_LIBRARY_PATH", "x")
            && !env_ok("lower", "x")
    );
}
