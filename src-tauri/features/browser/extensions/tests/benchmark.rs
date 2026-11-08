// SPDX-License-Identifier: MIT
//! Counts native runtime and bridge views and measures this host process only.
use super::support::{fail, Harness, PROBE_STORE};
use serde_json::json;
use std::time::Instant;

fn cpu_seconds() -> f64 {
    // SAFETY: a plain resource-usage query on this process.
    let usage = unsafe {
        let mut usage = std::mem::zeroed::<libc::rusage>();
        libc::getrusage(libc::RUSAGE_SELF, &mut usage);
        usage
    };
    let seconds = |t: libc::timeval| t.tv_sec as f64 + t.tv_usec as f64 / 1e6;
    seconds(usage.ru_utime) + seconds(usage.ru_stime)
}

pub fn run(root: &str, count: usize) {
    let harness = Harness::new("benchmark");
    let began = Instant::now();
    harness.request(json!({"operation": "configure", "controllerId": objc2_foundation::NSUUID::new().UUIDString().to_string(), "store": PROBE_STORE}));
    for index in 0..count {
        harness.fire(json!({
            "operation": "load", "id": index.to_string(), "guid": format!("benchmark-{index}@misty.test"),
            "origin": Harness::random_origin(), "runtimePath": root,
            "permissions": ["storage"], "hosts": [], "privateAccess": true,
        }));
    }
    for _ in 0..count {
        harness.wait_event("a sync bridge", 30.0, |e| e["kind"] == "sync-ready");
    }
    let startup = began.elapsed().as_secs_f64();
    let baseline = cpu_seconds();
    harness.spin(5.0);
    let used = cpu_seconds() - baseline;
    let diagnostics = harness.request(json!({"operation": "diagnostics"}));
    if diagnostics["runtimeCount"].as_u64() != Some(count as u64)
        || diagnostics["bridgeViewCount"].as_u64() != Some(count as u64)
    {
        fail(format!(
            "expected {count} runtimes and bridges, got {diagnostics}"
        ));
    }
    println!(
        "contexts={count} bridge_views={count} ready_seconds={startup:.3} host_peak_RSS_MiB={:.1} host_idle_CPU_seconds_over_5s={used:.4}",
        super::peak_rss_mib()
    );
    harness.request(json!({"operation": "configure", "account": "", "controllerId": objc2_foundation::NSUUID::new().UUIDString().to_string()}));
}
