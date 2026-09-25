use std::io::{Read, Write};
fn main() {
    let result = (|| -> Result<serde_json::Value, String> {
        let mut bytes = Vec::new();
        std::io::stdin()
            .take(32769)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > 32768 {
            return Err("Search request exceeds its limit.".into());
        }
        let request = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        let index =
            std::env::var_os("MISTY_SEARCH_INDEX").ok_or("Missing private index directory.")?;
        misty_file_search::execute(
            std::path::Path::new(&index),
            &std::env::current_dir().map_err(|e| e.to_string())?,
            request,
        )
    })();
    let response = match result {
        Ok(data) => serde_json::json!({"protocol":1,"data":data}),
        Err(error) => serde_json::json!({"protocol":1,"error":error}),
    };
    let bytes = serde_json::to_vec(&response).unwrap();
    if bytes.len() > 64 * 1024 * 1024 {
        std::process::exit(2);
    }
    if std::io::stdout().write_all(&bytes).is_err() {
        std::process::exit(1);
    }
}
