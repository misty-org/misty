//! LAN discovery between the account's devices (docs/design/devices/BRIEF.md).
//! Each device advertises a blinded ID and its transport port over mDNS. Only
//! devices that already know its key (from the signed device list) can tell
//! which device it is. A match is only a hint: the connection still has to
//! prove the key. This keeps the server off the critical path on a LAN.
use std::{
    collections::HashSet,
    net::{IpAddr, SocketAddr},
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};

use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use sha2::{Digest, Sha256};

use crate::infra::{device_records::endpoint_of, device_trust};

const SERVICE: &str = "_misty-device._udp.local.";

/// A trusted device found on this network, with its endpoint and candidates.
pub type FoundHandler = Arc<dyn Fn(String, String, Vec<String>) + Send + Sync>;

struct Running {
    daemon: ServiceDaemon,
    advertised: Option<(String, Vec<String>)>,
}

static RUNNING: OnceLock<Mutex<Option<Running>>> = OnceLock::new();

fn running() -> &'static Mutex<Option<Running>> {
    RUNNING.get_or_init(|| Mutex::new(None))
}

/// The blinded ID: the same for anyone who knows the endpoint key, opaque to
/// anyone who does not.
pub fn blinded_id(endpoint_id: &str) -> String {
    let digest = Sha256::digest(format!("misty.device.mdns.v1\n{endpoint_id}").as_bytes());
    hex::encode(&digest[..10])
}

/// Starts browsing for the account's devices. Safe to call again.
pub fn start(on_found: FoundHandler) {
    let Ok(mut slot) = running().lock() else {
        return;
    };
    if slot.is_some() {
        return;
    }
    let Ok(daemon) = ServiceDaemon::new() else {
        return;
    };
    let Ok(events) = daemon.browse(SERVICE) else {
        let _ = daemon.shutdown();
        return;
    };
    *slot = Some(Running {
        daemon,
        advertised: None,
    });
    std::thread::Builder::new()
        .name("misty-device-discovery".to_owned())
        .spawn(move || {
            while let Ok(event) = events.recv() {
                let ServiceEvent::ServiceResolved(info) = event else {
                    continue;
                };
                let Some(blinded) = info.get_property_val_str("d").map(str::to_owned) else {
                    continue;
                };
                let Some(list) = device_trust::current_list() else {
                    continue;
                };
                let own = device_trust::server_device_id();
                let Some((device_id, endpoint)) = list.admitted.iter().find_map(|member| {
                    let endpoint = endpoint_of(&member.public_key)?;
                    (blinded_id(&endpoint) == blinded && Some(&member.device_id) != own.as_ref())
                        .then(|| (member.device_id.clone(), endpoint))
                }) else {
                    continue;
                };
                let port = info.get_port();
                let candidates: Vec<String> = info
                    .get_addresses()
                    .iter()
                    .filter(|ip| {
                        matches!(ip, IpAddr::V4(_))
                            && crate::domain::lan::is_lan_address(**ip)
                            && !ip.is_loopback()
                    })
                    .take(8)
                    .map(|ip| SocketAddr::new(*ip, port).to_string())
                    .collect();
                if !candidates.is_empty() {
                    on_found(device_id, endpoint, candidates);
                }
            }
        })
        .ok();
}

/// Advertises this device at its current LAN candidates; re-registers only
/// when they change.
pub fn advertise(endpoint_id: &str, candidates: &[String]) {
    let Ok(mut slot) = running().lock() else {
        return;
    };
    let Some(running) = slot.as_mut() else {
        return;
    };
    let mut sorted = candidates.to_vec();
    sorted.sort();
    if running
        .advertised
        .as_ref()
        .is_some_and(|(endpoint, advertised)| endpoint == endpoint_id && *advertised == sorted)
    {
        return;
    }
    let addresses: Vec<SocketAddr> = sorted
        .iter()
        .filter_map(|candidate| candidate.parse().ok())
        .collect();
    let ports: HashSet<u16> = addresses.iter().map(SocketAddr::port).collect();
    let blinded = blinded_id(endpoint_id);
    let fullname = format!("{blinded}.{SERVICE}");
    let _ = running.daemon.unregister(&fullname);
    running.advertised = None;
    // One transport port serves every interface; skip ambiguous states.
    let (Some(port), 1) = (ports.iter().next().copied(), ports.len()) else {
        return;
    };
    let ips: Vec<IpAddr> = addresses.iter().map(SocketAddr::ip).collect();
    let host = format!("{blinded}.local.");
    let Ok(info) = ServiceInfo::new(
        SERVICE,
        &blinded,
        &host,
        &ips[..],
        port,
        &[("d", blinded.as_str())][..],
    ) else {
        return;
    };
    if running.daemon.register(info).is_ok() {
        running.advertised = Some((endpoint_id.to_owned(), sorted));
    }
}

pub fn stop() {
    if let Ok(mut slot) = running().lock() {
        if let Some(running) = slot.take() {
            let _ = running
                .daemon
                .shutdown()
                .map(|status| status.recv_timeout(Duration::from_secs(1)));
        }
    }
}
