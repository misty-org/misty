// Generates the `kiri:allow-call` permission that Misty's capability grants
// to website pages. Every other command stays unreachable from them.
const COMMANDS: &[&str] = &["call"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
