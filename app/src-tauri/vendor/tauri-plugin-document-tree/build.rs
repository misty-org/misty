const COMMANDS: &[&str] = &[
    "list_children",
    "persisted_trees",
    "pick_tree",
    "release_tree",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
