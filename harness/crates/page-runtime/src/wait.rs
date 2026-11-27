use crate::host::PageHost;
use serde_json::{json, Value};
use std::time::Instant;

pub async fn poll<H: PageHost>(
    host: &H,
    condition: &Value,
    timeout_ms: u64,
) -> Result<Value, String> {
    let started = Instant::now();
    loop {
        let check = host
            .call(None, "waitCheck", condition.clone(), false)
            .await?;
        let met = check["met"] == true
            || (condition["text"].is_string() && host.frames_show(condition).await);
        let waited = started.elapsed().as_millis() as u64;
        if met || waited >= timeout_ms {
            let page = host.call(None, "observe", json!({}), false).await?;
            return Ok(json!({"met": met, "waitedMs": waited, "page": page}));
        }
        host.sleep(250).await;
    }
}
