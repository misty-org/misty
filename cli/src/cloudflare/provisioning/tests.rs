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

fn options(apply: bool) -> Options {
    Options {
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
        let values = environment::read(workspace, Target::Dev)?;
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
fn development_still_provisions_worker_configuration_and_container_origin() {
    let temporary = tempfile::tempdir().unwrap();
    let workspace = Workspace::from_root(temporary.path().to_owned()).unwrap();
    let mut cloudflare = Cloudflare::default();
    cloudflare.run(&workspace, options(true)).unwrap();
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
}

#[test]
fn development_rerun_is_repeatable() {
    let temporary = tempfile::tempdir().unwrap();
    let workspace = Workspace::from_root(temporary.path().to_owned()).unwrap();
    let mut cloudflare = Cloudflare::default();
    cloudflare.run(&workspace, options(true)).unwrap();
    let config_before = cloudflare.config.clone();
    cloudflare.calls.clear();
    let mut rerun = options(true);
    rerun.hostname = None;
    cloudflare.run(&workspace, rerun).unwrap();
    assert_eq!(cloudflare.config, config_before);
    assert_eq!(cloudflare.tunnels.len(), 1);
    assert_eq!(cloudflare.dns.len(), 1);
    assert!(!cloudflare.calls.iter().any(|(method, _)| method == "POST"));
}

#[test]
fn conflicting_dns_is_rejected_before_writes() {
    let temporary = tempfile::tempdir().unwrap();
    let workspace = Workspace::from_root(temporary.path().to_owned()).unwrap();
    let mut cloudflare = Cloudflare {
        dns: vec![json!({"type":"A", "content":"192.0.2.1"})],
        ..Default::default()
    };
    assert!(cloudflare
        .run(&workspace, options(true))
        .unwrap_err()
        .to_string()
        .contains("DNS hostname"));
    assert!(cloudflare.only_reads());
}
