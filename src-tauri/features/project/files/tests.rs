// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
use super::search::{file_index_blocking, search_text_blocking};
use super::*;
use std::path::PathBuf;

struct Scratch(PathBuf);
impl Scratch {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("misty-files-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        Self(std::fs::canonicalize(dir).unwrap())
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn trash_calls_go_through_move_to_trash() {
    let needle = ["trash", "::delete("].concat();
    let mut offenders = Vec::new();
    let mut stack = vec![PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("features")];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).unwrap().flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().is_some_and(|extension| extension == "rs")
                && std::fs::read_to_string(&path).unwrap().contains(&needle)
            {
                offenders.push(path.display().to_string());
            }
        }
    }
    assert!(offenders.is_empty(), "direct trash deletes: {offenders:?}");
}

#[test]
fn list_dir_flags_git_ignored_entries_only_when_asked() {
    let workspace = Scratch::new();
    git2::Repository::init(&workspace.0).unwrap();
    std::fs::write(workspace.0.join(".gitignore"), "*.log\n").unwrap();
    std::fs::write(workspace.0.join("debug.log"), "").unwrap();
    std::fs::write(workspace.0.join("main.rs"), "").unwrap();
    std::fs::create_dir(workspace.0.join("src")).unwrap();

    let plain = list_dir_blocking(&workspace.0, None).unwrap();
    assert!(plain.iter().all(|entry| !entry.ignored));
    assert_eq!(plain[0].name, ".git", "folders come first");

    let entries = list_dir_blocking(&workspace.0, Some(&workspace.0)).unwrap();
    let flag = |name: &str| {
        entries
            .iter()
            .find(|entry| entry.name == name)
            .unwrap()
            .ignored
    };
    assert!(flag(".git"));
    assert!(flag("debug.log"));
    assert!(!flag("main.rs"));
    assert!(!flag(".gitignore"));
    assert!(!flag("src"));
}

#[test]
fn list_dir_leaves_out_the_systems_own_files() {
    let scratch = Scratch::new();
    let made = [
        ".DS_Store",
        "Thumbs.db",
        "Desktop.ini",
        "main.rs",
        ".env.local",
    ];
    for name in made {
        std::fs::write(scratch.0.join(name), "").unwrap();
    }
    let names: Vec<String> = list_dir_blocking(&scratch.0, None)
        .unwrap()
        .into_iter()
        .map(|entry| entry.name)
        .collect();
    assert_eq!(names, vec![".env.local".to_owned(), "main.rs".to_owned()]);
}

#[test]
fn reads_text_images_and_binaries_apart() {
    let scratch = Scratch::new();
    std::fs::write(scratch.0.join("a.txt"), "hello").unwrap();
    std::fs::write(scratch.0.join("b.png"), [0x89, b'P', b'N', b'G']).unwrap();
    std::fs::write(scratch.0.join("c.bin"), [1, 0, 2]).unwrap();
    let text = read_file_blocking(&scratch.0.join("a.txt")).unwrap();
    assert_eq!((text.kind, text.text.as_deref()), ("text", Some("hello")));
    assert_eq!(text.size, 5);
    let image = read_file_blocking(&scratch.0.join("b.png")).unwrap();
    assert_eq!(image.kind, "image");
    assert!(
        image.text.is_none(),
        "an image's bytes load by URL, not here"
    );
    assert_eq!(image.size, 4);
    assert!(image.mtime_ms > 0);
    assert_eq!(
        read_file_blocking(&scratch.0.join("c.bin")).unwrap().kind,
        "binary"
    );
}

#[test]
fn an_image_of_any_size_opens_without_reading_its_bytes() {
    let scratch = Scratch::new();
    let big = scratch.0.join("huge.jpg");
    std::fs::File::create(&big)
        .unwrap()
        .set_len(64 * 1024 * 1024)
        .unwrap();
    let image = read_file_blocking(&big).unwrap();
    assert_eq!((image.kind, image.size), ("image", 64 * 1024 * 1024));
    assert_eq!(image_mime(&big), "image/jpeg");
}

#[test]
fn a_long_file_is_read_in_part_and_marked() {
    let scratch = Scratch::new();
    std::fs::write(scratch.0.join("big.txt"), "x".repeat(MAX_READ_BYTES + 10)).unwrap();
    let read = read_file_blocking(&scratch.0.join("big.txt")).unwrap();
    assert!(read.truncated);
    assert_eq!(read.text.unwrap().len(), MAX_READ_BYTES);
}

#[test]
fn search_finds_lines_ignoring_case_and_skips_hidden_and_heavy_folders() {
    let scratch = Scratch::new();
    std::fs::create_dir_all(scratch.0.join("src")).unwrap();
    std::fs::create_dir_all(scratch.0.join("node_modules/pkg")).unwrap();
    std::fs::create_dir_all(scratch.0.join(".cache")).unwrap();
    std::fs::write(
        scratch.0.join("src/a.rs"),
        "fn main() {}\nlet Needle = 1;\n",
    )
    .unwrap();
    std::fs::write(scratch.0.join("node_modules/pkg/b.js"), "needle").unwrap();
    std::fs::write(scratch.0.join(".cache/c"), "needle").unwrap();
    let hits = search_text_blocking(&scratch.0, " needle ");
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].line, 2);
    assert_eq!(hits[0].text, "let Needle = 1;");
    assert!(search_text_blocking(&scratch.0, "   ").is_empty());
}

#[test]
fn the_file_index_honors_gitignore_and_skips_heavy_folders() {
    let scratch = Scratch::new();
    git2::Repository::init(&scratch.0).unwrap();
    std::fs::write(scratch.0.join(".gitignore"), "dist/\n").unwrap();
    std::fs::create_dir_all(scratch.0.join("dist")).unwrap();
    std::fs::create_dir_all(scratch.0.join("target/debug")).unwrap();
    std::fs::create_dir_all(scratch.0.join("src")).unwrap();
    std::fs::write(scratch.0.join("dist/out.js"), "").unwrap();
    std::fs::write(scratch.0.join("src/main.rs"), "").unwrap();
    let mut rels: Vec<String> = file_index_blocking(&scratch.0)
        .into_iter()
        .map(|entry| entry.rel)
        .collect();
    rels.sort();
    assert_eq!(rels, ["src", "src/main.rs"]);
}
