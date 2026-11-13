const COMMANDS: &[&str] = &["remove", "retrieve", "store"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
