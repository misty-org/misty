fn main() {
    // An engine starts Misty's own binary as an on-demand proxy for one of its MCP servers
    // (Settings › Tools › MCP servers); that process serves stdio and never opens a window.
    if std::env::args().nth(1).as_deref() == Some(misty_native::engine_config::mcp::lazy::FLAG) {
        if let Err(error) =
            misty_native::engine_config::mcp::lazy::serve(std::env::args().skip(2).collect())
        {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
    misty_native::run();
}
