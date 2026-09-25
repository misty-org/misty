use std::{
    io::Read,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
pub fn cancellation() -> Arc<AtomicBool> {
    let cancel = Arc::new(AtomicBool::new(false));
    let flag = cancel.clone();
    std::thread::spawn(move || {
        let _ = std::io::stdin().read(&mut [0]);
        flag.store(true, Ordering::Release);
    });
    cancel
}
pub fn request() -> Result<serde_json::Value, String> {
    let text = std::env::var("MISTY_WORK_REQUEST").map_err(|e| e.to_string())?;
    if text.len() > 32768 {
        return Err("Request too large.".into());
    }
    serde_json::from_str(&text).map_err(|e| e.to_string())
}
pub fn respond(result: Result<serde_json::Value, String>) {
    let value = match result {
        Ok(data) => serde_json::json!({"protocol":1,"data":data}),
        Err(error) => serde_json::json!({"protocol":1,"error":error}),
    };
    println!("{}", value);
}
pub unsafe fn directory(fd: i32) -> cap_std::fs::Dir {
    use std::os::fd::FromRawFd;
    cap_std::fs::Dir::from_std_file(std::fs::File::from_raw_fd(fd))
}
