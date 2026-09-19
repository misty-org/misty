mod engine;
mod runtime;
mod scan;
fn main() {
    runtime::respond(runtime::request().and_then(|request| {
        let cancel = runtime::cancellation();
        if request["operation"] == "scan" {
            scan::scan(
                &unsafe { runtime::directory(100) },
                request["name"].as_str().unwrap_or("Folder"),
                &cancel,
            )
        } else {
            engine::execute(request, cancel)
        }
    }));
}
