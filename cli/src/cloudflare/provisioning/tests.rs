use super::*;
#[test]
fn rerunning_setup_preserves_unrelated_routes() {
    let before = json!({"config": {"originRequest": {"connectTimeout": 15}, "ingress": [
        {"hostname":"other.example.com", "service":"http://other:80"},
        {"service":"http_status:404"}
    ]}});
    let first = merge_ingress(&before, "api.example.com", "http://misty-api:8080").unwrap();
    assert_eq!(first["ingress"].as_array().unwrap().len(), 3);
    assert_eq!(first["ingress"][0], before["config"]["ingress"][0]);
    assert_eq!(first["originRequest"], before["config"]["originRequest"]);
    let second = merge_ingress(
        &json!({"config":first}),
        "api.example.com",
        "http://misty-api:8080",
    )
    .unwrap();
    assert_eq!(first, second);
    assert!(merge_ingress(&before, "other.example.com", "http://misty-api:8080").is_err());
}

const ACCOUNT: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ZONE: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

fn options(target: Target, apply: bool) -> Options {
    Options {
        target,
        apply,
        account: None,
        zone: None,
        hostname: Some("api.example.com".into()),
        tunnel_name: None,
    }
}

#[derive(Default)]
struct Cloudflare {
    tunnels: Vec<Value>,
    dns: Vec<Value>,
    config: Value,
    calls: Vec<(String, String)>,
}
impl Cloudflare {
    fn request(&mut self, method: &str, path: &str, body: Option<Value>) -> Result<Value> {
        self.calls.push((method.to_owned(), path.to_owned()));
        match (method, path) {
            ("GET", p) if p == format!("zones/{ZONE}") => {
                Ok(json!({"name":"example.com", "account":{"id":ACCOUNT}}))
            }
            ("GET", p) if p.contains("/cfd_tunnel?") => Ok(json!(self.tunnels)),
            ("GET", p) if p.contains("/dns_records?") => Ok(json!(self.dns)),
            ("GET", p) if p.ends_with("/configurations") => Ok(self.config.clone()),
            ("GET", p) if p.ends_with("/workers/subdomain") => Ok(json!({"subdomain":"fixture"})),
            ("POST", p) if p.ends_with("/cfd_tunnel") => {
                let mut tunnel = body.unwrap();
                tunnel["id"] = json!("fixture-tunnel");
                self.tunnels.push(tunnel.clone());
                Ok(tunnel)
            }
            ("PUT", p) if p.ends_with("/configurations") => {
                self.config = body.unwrap();
                Ok(self.config.clone())
            }
            ("POST", p) if p.ends_with("/dns_records") => {
                let mut record = body.unwrap();
                record["id"] = json!("fixture-record");
                self.dns.push(record.clone());
                Ok(record)
            }
            ("PATCH", p) if p.ends_with("/dns_records/fixture-record") => {
                self.dns[0]["proxied"] = json!(true);
                Ok(self.dns[0].clone())
            }
            ("GET", p) if p.ends_with("/token") => Ok(json!("fixture-connector-token")),
            _ => panic!("unexpected Cloudflare request: {method} {path}"),
        }
    }
    fn run(&mut self, workspace: &Workspace, options: Options) -> Result<()> {
        let values = environment::read(workspace, options.target)?;
        provision(
            workspace,
            options,
            values,
            "fixture-api-token".into(),
            ACCOUNT.into(),
            ZONE.into(),
            |method, path, body| self.request(method, path, body),
        )
    }
    fn only_reads(&self) -> bool {
        self.calls.iter().all(|(method, _)| method == "GET")
    }
}

#[test]
fn production_preview_has_no_remote_or_local_writes_and_no_worker_dependency() {
    let temporary = tempfile::tempdir().unwrap();
    let workspace = Workspace::from_root(temporary.path().to_owned()).unwrap();
    let mut cloudflare = Cloudflare::default();
    cloudflare
        .run(&workspace, options(Target::Prod, false))
        .unwrap();
    assert!(cloudflare.only_reads());
    assert!(!workspace.server.exists());
    assert!(!cloudflare
        .calls
        .iter()
        .any(|(_, path)| path.contains("workers")));
}

#[test]
fn production_apply_is_isolated_and_repeatable() {
    let temporary = tempfile::tempdir().unwrap();
    let workspace = Workspace::from_root(temporary.path().to_owned()).unwrap();
    environment::set(
        &workspace,
        Target::Dev,
        "CLOUDFLARE_TUNNEL_TOKEN",
        "unchanged-dev-token",
    )
    .unwrap();
    let dev_path = environment::root(&workspace, Target::Dev).join("integrations/cloudflare.env");
    let dev_before = std::fs::read(&dev_path).unwrap();
    environment::set(&workspace, Target::Prod, "MISTY_HOST_PORT", "9081").unwrap();
    environment::set(
        &workspace,
        Target::Prod,
        "MISTY_CLOUDFLARE_WORKER_HOST",
        "preserved.workers.dev",
    )
    .unwrap();
    let mut cloudflare = Cloudflare::default();
    cloudflare
        .run(&workspace, options(Target::Prod, true))
        .unwrap();
    assert_eq!(
        cloudflare.config["config"]["ingress"][0]["service"],
        "http://127.0.0.1:9081"
    );
    assert_eq!(cloudflare.tunnels[0]["name"], "misty-prod-api-example-com");
    assert_eq!(std::fs::read(dev_path).unwrap(), dev_before);
    let saved = environment::read(&workspace, Target::Prod).unwrap();
    assert_eq!(saved["CLOUDFLARE_TUNNEL_TOKEN"], "fixture-connector-token");
    assert_eq!(saved["MISTY_PUBLIC_API_URL"], "https://api.example.com/v1");
    assert_eq!(
        saved["MISTY_CLOUDFLARE_WORKER_HOST"],
        "preserved.workers.dev"
    );
    assert!(!saved.contains_key("MISTY_DEV_API_ORIGIN"));
    assert!(!saved.contains_key("MISTY_DEV_API_TUNNEL_HOSTNAME"));
    assert!(!cloudflare
        .calls
        .iter()
        .any(|(_, path)| path.contains("workers")));
    let config_before = cloudflare.config.clone();
    cloudflare.calls.clear();
    let mut rerun = options(Target::Prod, true);
    rerun.hostname = None;
    cloudflare.run(&workspace, rerun).unwrap();
    assert_eq!(cloudflare.config, config_before);
    assert_eq!(cloudflare.tunnels.len(), 1);
    assert_eq!(cloudflare.dns.len(), 1);
    assert!(!cloudflare.calls.iter().any(|(method, _)| method == "POST"));
}

#[test]
fn development_still_provisions_worker_configuration_and_container_origin() {
    let temporary = tempfile::tempdir().unwrap();
    let workspace = Workspace::from_root(temporary.path().to_owned()).unwrap();
    let mut cloudflare = Cloudflare::default();
    cloudflare
        .run(&workspace, options(Target::Dev, true))
        .unwrap();
    let values = environment::read(&workspace, Target::Dev).unwrap();
    assert_eq!(
        values["MISTY_CLOUDFLARE_WORKER_HOST"],
        "misty-api-example-com.fixture.workers.dev"
    );
    assert_eq!(values["MISTY_DEV_API_ORIGIN"], "https://api.example.com");
    assert_eq!(cloudflare.tunnels[0]["name"], "misty-api-example-com");
    assert_eq!(
        cloudflare.config["config"]["ingress"][0]["service"],
        "http://misty-api:8080"
    );
    assert!(!environment::root(&workspace, Target::Prod).exists());
}

#[test]
fn conflicting_dns_or_development_tunnel_is_rejected_before_writes() {
    let temporary = tempfile::tempdir().unwrap();
    let workspace = Workspace::from_root(temporary.path().to_owned()).unwrap();
    let mut cloudflare = Cloudflare {
        dns: vec![json!({"type":"A", "content":"192.0.2.1"})],
        ..Default::default()
    };
    assert!(cloudflare
        .run(&workspace, options(Target::Prod, true))
        .unwrap_err()
        .to_string()
        .contains("DNS hostname"));
    assert!(cloudflare.only_reads());
    cloudflare.dns.clear();
    cloudflare.tunnels.push(json!({"name":"misty-prod-api-example-com", "id":"fixture-tunnel", "config_src":"cloudflare"}));
    cloudflare.config = json!({"config":{"ingress":[{"hostname":"dev-api.example.com", "service":"http://misty-api:8080"},{"service":"http_status:404"}]}});
    let before = cloudflare.config.clone();
    assert!(cloudflare
        .run(&workspace, options(Target::Prod, true))
        .unwrap_err()
        .to_string()
        .contains("serves development"));
    assert!(cloudflare.only_reads());
    assert_eq!(cloudflare.config, before);
    assert!(!workspace.server.exists());
}

#[test]
fn production_requires_its_own_hostname_and_valid_port() {
    let mut options = options(Target::Prod, false);
    options.hostname = None;
    let mut values = BTreeMap::from([(
        "MISTY_DEV_API_TUNNEL_HOSTNAME".into(),
        "dev-api.example.com".into(),
    )]);
    assert!(selected_hostname(&options, &values).is_err());
    assert_eq!(
        service(Target::Prod, &values).unwrap(),
        "http://127.0.0.1:8081"
    );
    for port in ["0", "65536", "bad"] {
        values.insert("MISTY_HOST_PORT".into(), port.into());
        assert!(service(Target::Prod, &values).is_err());
    }
}
