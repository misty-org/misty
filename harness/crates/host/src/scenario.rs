use misty_page_runtime::{Approval, PageHost};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;
use std::time::Duration;

pub enum Ask {
    Capture([f64; 4], f64, bool, Sender<Result<String, String>>),
    Cookies(Value, Sender<Result<String, String>>),
    Emulate(Value, Sender<Result<String, String>>),
    Resize(Option<(f64, f64)>, Sender<Result<String, String>>),
    Pdf(Sender<Result<Vec<u8>, String>>),
    Dialogs(Value, Sender<Result<String, String>>),
    Fire(String),
    Native(Value, Sender<Result<String, String>>),
    World(String, Sender<Result<String, String>>),
    Page(String, Sender<Result<String, String>>),
    Load(String, Sender<Result<String, String>>),
}

pub struct Scenario {
    pub start: String,
    pub base: String,
    pub entries: Vec<Value>,
    pub native: bool,
}

pub fn read(path: &Path) -> Result<Scenario, String> {
    let text =
        std::fs::read_to_string(path).map_err(|error| format!("{}: {error}", path.display()))?;
    let value: Value =
        serde_json::from_str(&text).map_err(|error| format!("{}: {error}", path.display()))?;
    let folder = path
        .canonicalize()
        .map_err(|error| error.to_string())?
        .parent()
        .ok_or("the scenario has no folder")?
        .to_path_buf();
    let base = serve(folder)?;
    let start = address_of(
        &base,
        value["page"]
            .as_str()
            .ok_or("a scenario names its first page")?,
    );
    let entries = value["run"]
        .as_array()
        .cloned()
        .ok_or("a scenario lists what to run")?;
    Ok(Scenario {
        start,
        base,
        entries,
        native: value["native"] == true,
    })
}

pub fn address_of(base: &str, page: &str) -> String {
    if page.contains("://") || page.starts_with("data:") || page.starts_with("about:") {
        return page.to_owned();
    }
    format!("{base}/{}", page.trim_start_matches('/'))
}

pub fn serve(folder: PathBuf) -> Result<String, String> {
    use std::io::{BufRead, BufReader, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|error| error.to_string())?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let folder = folder.clone();
            std::thread::spawn(move || {
                let mut reader = BufReader::new(&stream);
                let mut line = String::new();
                if reader.read_line(&mut line).is_err() {
                    return;
                }
                let mut length = 0usize;
                loop {
                    let mut header = String::new();
                    if reader
                        .read_line(&mut header)
                        .map(|read| read <= 2)
                        .unwrap_or(true)
                    {
                        break;
                    }
                    if let Some((name, value)) = header.split_once(':') {
                        if name.trim().eq_ignore_ascii_case("content-length") {
                            length = value.trim().parse().unwrap_or(0);
                        }
                    }
                }
                let mut body = vec![0; length.min(1 << 20)];
                let _ = std::io::Read::read_exact(&mut reader, &mut body);
                let path = line.split_whitespace().nth(1).unwrap_or("/");
                if let Some(ms) = path
                    .split_once("ms=")
                    .and_then(|(_, rest)| rest.split('&').next())
                    .and_then(|ms| ms.parse::<u64>().ok())
                {
                    std::thread::sleep(Duration::from_millis(ms.min(10_000)));
                }
                let path = path
                    .split(['?', '#'])
                    .next()
                    .unwrap_or("/")
                    .trim_start_matches('/');
                let file = folder.join(if path.is_empty() { "index.html" } else { path });
                let inside = file
                    .canonicalize()
                    .ok()
                    .filter(|found| found.starts_with(&folder));
                let (status, kind, body) = match inside
                    .and_then(|found| std::fs::read(&found).ok().map(|bytes| (found, bytes)))
                {
                    Some((found, bytes)) => {
                        let kind = match found.extension().and_then(|ext| ext.to_str()) {
                            Some("html") => "text/html; charset=utf-8",
                            Some("js") => "text/javascript",
                            Some("css") => "text/css",
                            Some("json") => "application/json",
                            Some("png") => "image/png",
                            Some("txt") => "text/plain; charset=utf-8",
                            _ => "application/octet-stream",
                        };
                        ("200 OK", kind, bytes)
                    }
                    None => ("404 Not Found", "text/plain", b"Not found".to_vec()),
                };
                let mut stream = &stream;
                let _ = write!(
                    stream,
                    "HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = stream.write_all(&body);
            });
        }
    });
    Ok(format!("http://127.0.0.1:{port}"))
}

pub struct ScenarioHost<F: Fn(Ask) + Sync> {
    pub send: F,
    pub installs: std::sync::atomic::AtomicU64,
    pub approval: Mutex<Option<String>>,
    next: Mutex<u64>,
}

impl<F: Fn(Ask) + Sync> ScenarioHost<F> {
    pub fn new(send: F) -> Self {
        Self {
            send,
            installs: std::sync::atomic::AtomicU64::new(0),
            approval: Mutex::new(None),
            next: Mutex::new(0),
        }
    }

    fn ask(
        &self,
        make: impl FnOnce(Sender<Result<String, String>>) -> Ask,
    ) -> Result<String, String> {
        let (reply, answer) = channel();
        (self.send)(make(reply));
        answer
            .recv_timeout(Duration::from_secs(30))
            .map_err(|_| "the page didn't answer within 30 seconds".to_owned())?
    }

    pub fn page(&self, js: &str) -> Result<Value, String> {
        let raw = self.ask(|reply| Ask::Page(js.to_owned(), reply))?;
        Ok(serde_json::from_str(&raw).unwrap_or(Value::String(raw)))
    }

    pub fn load(&self, url: &str) -> Result<String, String> {
        self.ask(|reply| Ask::Load(url.to_owned(), reply))
    }
}

impl<F: Fn(Ask) + Sync> PageHost for ScenarioHost<F> {
    async fn call(
        &self,
        frame: Option<u64>,
        operation: &str,
        args: Value,
        semantic: bool,
    ) -> Result<Value, String> {
        let _ = semantic;
        if frame.is_some() {
            return Err("the scenario host reads the main frame only".into());
        }
        let invocation = format!(
            "const args = {};",
            serde_json::to_string(&args).map_err(|error| error.to_string())?
        );
        let light = misty_page_runtime::light_body(operation, &invocation);
        let mut raw = self.ask(|reply| Ask::World(light, reply))?;
        if misty_page_runtime::missing(&raw) {
            self.installs
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let full = misty_page_runtime::full_body(operation, &invocation);
            raw = self.ask(|reply| Ask::World(full, reply))?;
        }
        serde_json::from_str(&raw).map_err(|error| format!("{operation}: {error}: {raw}"))
    }

    async fn native(&self, input: Value, prepared: &Value) -> Result<Option<Value>, String> {
        if std::env::var_os("MISTY_HARNESS_SCRIPT_INPUT").is_some() {
            return Ok(None);
        }
        let encoded = json!({"action": input, "viewport": prepared["viewport"], "editable": prepared["editable"] == true});
        let raw = self.ask(|reply| Ask::Native(encoded, reply))?;
        let result: Value = serde_json::from_str(&raw).map_err(|error| error.to_string())?;
        match result["error"].as_str() {
            Some(error) if error.contains("must be visible") => Ok(None),
            Some(error) => Err(error.to_owned()),
            None => Ok(Some(result)),
        }
    }

    async fn approve(&self, kind: &str, control: &str, reason: &str) -> Approval {
        let _ = (kind, control, reason);
        match self
            .approval
            .lock()
            .ok()
            .and_then(|answer| answer.clone())
            .as_deref()
        {
            Some("allow") => Approval::Allowed,
            Some("refuse") => Approval::Refused,
            _ => Approval::Unasked,
        }
    }

    fn authorize(&self) -> Result<(), String> {
        Ok(())
    }

    async fn sleep(&self, ms: u64) {
        std::thread::sleep(Duration::from_millis(ms));
    }

    fn url(&self) -> Option<String> {
        match self.page("return location.href") {
            Ok(Value::String(url)) => Some(url),
            _ => None,
        }
    }

    fn go(&self, to: misty_page_runtime::Go<'_>) -> Result<(), String> {
        let script = match to {
            misty_page_runtime::Go::Address(address) => format!(
                "location.href = {}",
                serde_json::to_string(address).map_err(|error| error.to_string())?
            ),
            misty_page_runtime::Go::Back => "history.back()".into(),
            misty_page_runtime::Go::Forward => "history.forward()".into(),
            misty_page_runtime::Go::Reload => "location.reload()".into(),
        };
        (self.send)(Ask::Fire(script));
        Ok(())
    }

    async fn capture(
        &self,
        region: [f64; 4],
        image_width: f64,
        lossless: bool,
    ) -> Result<Value, String> {
        let raw = self.ask(|reply| Ask::Capture(region, image_width, lossless, reply))?;
        serde_json::from_str(&raw).map_err(|error| error.to_string())
    }

    async fn cookies(&self, request: Value) -> Result<Value, String> {
        let raw = self.ask(|reply| Ask::Cookies(request, reply))?;
        serde_json::from_str(&raw).map_err(|error| error.to_string())
    }

    async fn emulate(&self, request: Value) -> Result<Value, String> {
        let raw = self.ask(|reply| Ask::Emulate(request, reply))?;
        serde_json::from_str(&raw).map_err(|error| error.to_string())
    }

    fn holds_dialogs(&self) -> bool {
        true
    }

    async fn hold_dialogs(&self, on: bool) {
        let _ = self.ask(|reply| Ask::Dialogs(json!({"hold": on}), reply));
    }

    async fn held_dialog(&self) -> Option<Value> {
        let raw = self
            .ask(|reply| Ask::Dialogs(json!({"held": true}), reply))
            .ok()?;
        serde_json::from_str::<Value>(&raw)
            .ok()
            .filter(Value::is_object)
    }

    async fn answer_dialog(&self, accept: bool, text: Option<String>) -> Option<Value> {
        let raw = self
            .ask(|reply| Ask::Dialogs(json!({"answer": accept, "text": text}), reply))
            .ok()?;
        serde_json::from_str::<Value>(&raw)
            .ok()
            .filter(Value::is_object)
    }

    async fn resize(&self, size: Option<(f64, f64)>) -> Result<(), String> {
        self.ask(|reply| Ask::Resize(size, reply)).map(|_| ())
    }

    async fn pdf(&self) -> Result<Vec<u8>, String> {
        let (reply, answer) = std::sync::mpsc::channel();
        (self.send)(Ask::Pdf(reply));
        answer
            .recv_timeout(Duration::from_secs(20))
            .map_err(|_| "no PDF came back".to_owned())?
    }

    fn fresh_id(&self) -> String {
        let mut next = self
            .next
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *next += 1;
        format!("scenario-{}-{next}", std::process::id())
    }
}

fn substitute(value: &mut Value, saved: &std::collections::HashMap<String, Value>) {
    match value {
        Value::String(text) if text.starts_with('$') => {
            let mut parts = text[1..].split('.');
            let found = parts.next().and_then(|key| saved.get(key)).map(|root| {
                parts.fold(root.clone(), |at, part| {
                    match part.parse::<usize>() {
                        Ok(index) => at.get(index).cloned(),
                        Err(_) => at.get(part).cloned(),
                    }
                    .unwrap_or(Value::Null)
                })
            });
            if let Some(found) = found {
                *value = found;
            }
        }
        Value::Array(items) => items.iter_mut().for_each(|item| substitute(item, saved)),
        Value::Object(fields) => fields.values_mut().for_each(|item| substitute(item, saved)),
        _ => {}
    }
}

pub fn matches(expected: &Value, actual: &Value, at: &str) -> Result<(), String> {
    match (expected, actual) {
        (Value::Object(want), Value::Object(have)) => {
            for (key, value) in want {
                matches(
                    value,
                    have.get(key).unwrap_or(&Value::Null),
                    &format!("{at}.{key}"),
                )?;
            }
            Ok(())
        }
        (Value::Array(want), Value::Array(have)) => {
            for (index, value) in want.iter().enumerate() {
                matches(
                    value,
                    have.get(index).unwrap_or(&Value::Null),
                    &format!("{at}[{index}]"),
                )?;
            }
            Ok(())
        }
        (Value::String(want), _) if want.starts_with('~') => {
            let text = match actual {
                Value::String(text) => text.clone(),
                other => other.to_string(),
            };
            if text.contains(&want[1..]) {
                Ok(())
            } else {
                Err(format!(
                    "{at}: expected it to contain {:?}, got {text}",
                    &want[1..]
                ))
            }
        }
        (Value::String(want), _) if want == "*" => {
            if actual.is_null() {
                Err(format!("{at}: expected a value, got nothing"))
            } else {
                Ok(())
            }
        }
        (Value::Number(want), Value::Number(have)) if want.as_f64() == have.as_f64() => Ok(()),
        _ if expected == actual => Ok(()),
        _ => Err(format!("{at}: expected {expected}, got {actual}")),
    }
}

pub fn block_on<T>(future: impl std::future::Future<Output = T>) -> T {
    use std::sync::Arc;
    use std::task::{Context, Poll, Wake, Waker};
    struct Thread(std::thread::Thread);
    impl Wake for Thread {
        fn wake(self: Arc<Self>) {
            self.0.unpark();
        }
    }
    let waker = Waker::from(Arc::new(Thread(std::thread::current())));
    let mut context = Context::from_waker(&waker);
    let mut future = std::pin::pin!(future);
    loop {
        if let Poll::Ready(value) = future.as_mut().poll(&mut context) {
            return value;
        }
        std::thread::park_timeout(Duration::from_millis(10));
    }
}

pub fn run<F: Fn(Ask) + Sync>(host: &ScenarioHost<F>, scenario: &Scenario) -> Result<(), String> {
    if scenario.native && std::env::var_os("MISTY_HARNESS_SCRIPT_INPUT").is_some() {
        println!("skip it needs real input, which only the native run has");
        return Ok(());
    }
    let mut document = String::new();
    let mut saved: std::collections::HashMap<String, Value> = std::collections::HashMap::new();
    let mut failures = 0;
    for (index, entry) in scenario.entries.iter().enumerate() {
        let name = entry["name"]
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| format!("step {}", index + 1));
        if let Some(answer) = entry["approve"].as_str() {
            if let Ok(mut approval) = host.approval.lock() {
                *approval = Some(answer.to_owned());
            }
        }
        let mut entry = entry.clone();
        if let Some(js) = entry["js"].as_str() {
            let mut js = js.to_owned();
            for (key, value) in &saved {
                js = js.replace(&format!("${key}"), &value.to_string());
            }
            entry["js"] = json!(js);
        }
        for field in ["input", "args"] {
            if let Some(value) = entry.get_mut(field) {
                substitute(value, &saved);
            }
        }
        let entry = &entry;
        let outcome = block_on(one(host, scenario, entry, &mut document));
        let outcome = match (entry["expectError"].as_str(), outcome) {
            (Some(want), Err(error)) if error.contains(want) => Ok(Value::Null),
            (Some(want), Err(error)) => {
                Err(format!("expected an error with {want:?}, got {error}"))
            }
            (Some(want), Ok(value)) => Err(format!("expected an error with {want:?}, got {value}")),
            (None, outcome) => outcome,
        };
        let checked = outcome.and_then(|value| {
            if let Some(found) = value["documentId"].as_str() {
                document = found.to_owned();
            }
            if let Some(found) = value["snapshot"]["documentId"].as_str() {
                document = found.to_owned();
            }
            if let Some(key) = entry["save"].as_str() {
                saved.insert(key.to_owned(), value.clone());
            }
            if entry.get("print") == Some(&json!(true)) {
                eprintln!(
                    "{}",
                    serde_json::to_string_pretty(&value).unwrap_or_default()
                );
            }
            match entry.get("expect") {
                Some(expected) => matches(expected, &value, "answer").map_err(|error| {
                    format!(
                        "{error}\n    answer: {}",
                        serde_json::to_string(&value).unwrap_or_default()
                    )
                }),
                None => Ok(()),
            }
        });
        match checked {
            Ok(()) => println!("ok   {name}"),
            Err(error) => {
                failures += 1;
                println!("FAIL {name}: {error}");
            }
        }
    }
    if failures == 0 {
        Ok(())
    } else {
        Err(format!("{failures} of {} failed", scenario.entries.len()))
    }
}

async fn one<F: Fn(Ask) + Sync>(
    host: &ScenarioHost<F>,
    scenario: &Scenario,
    entry: &Value,
    document: &mut String,
) -> Result<Value, String> {
    let operation = entry["op"].as_str().ok_or("each entry has an op")?;
    match operation {
        "load" => {
            let url = address_of(
                &scenario.base,
                entry["page"].as_str().ok_or("load names a page")?,
            );
            let landed = host.load(&url)?;
            document.clear();
            Ok(json!({"url": landed}))
        }
        "page" => host.page(entry["js"].as_str().ok_or("page runs js")?),
        "activate" => {
            let viewport = host.page("return {width: innerWidth, height: innerHeight}")?;
            let click = json!({"action": {"kind": "click", "x": 0.95, "y": 0.95, "button": "left", "clickCount": 1}, "viewport": viewport, "editable": false});
            let raw = host.ask(|reply| Ask::Native(click, reply))?;
            serde_json::from_str(&raw).map_err(|error| error.to_string())
        }
        "installs" => Ok(json!(host
            .installs
            .load(std::sync::atomic::Ordering::Relaxed))),
        "navigate" => {
            let address;
            let go = match (entry["page"].as_str(), entry["history"].as_str()) {
                (Some(page), _) => {
                    address = address_of(&scenario.base, page);
                    misty_page_runtime::Go::Address(&address)
                }
                (None, Some(history)) => misty_page_runtime::Go::history(history)
                    .ok_or("history is back, forward or reload")?,
                _ => return Err("navigate names a page or history".into()),
            };
            let answer = misty_page_runtime::navigate(host, go, true).await?;
            document.clear();
            Ok(answer)
        }
        "wait" => {
            std::thread::sleep(Duration::from_millis(entry["ms"].as_u64().unwrap_or(100)));
            Ok(json!({}))
        }
        "steps" | "fill_form" | "skill" => {
            let mut input = entry["input"].clone();
            if !input.is_object() {
                input = json!({});
            }
            if input.get("documentId").is_none() {
                input["documentId"] = json!(document.clone());
            }
            if operation == "skill" {
                return misty_page_runtime::run_skill(host, &input).await;
            }
            let steps = if operation == "fill_form" {
                misty_page_runtime::form_steps(&input)
            } else {
                misty_page_runtime::parse_steps(&input)
            };
            match steps {
                Ok(steps) => misty_page_runtime::run_steps(host, &input, &steps).await,
                Err(error) => Ok(misty_page_runtime::rejected("browser_step_invalid", error)),
            }
        }
        "storage" => misty_page_runtime::storage(host, &entry["input"]).await,
        "emulate" => misty_page_runtime::emulate(host, &entry["input"]).await,
        "page_tools" => misty_page_runtime::page_tools(host, &entry["input"]).await,
        "pdf" => host
            .pdf()
            .await
            .map(|bytes| json!({"bytes": bytes.len(), "pdf": bytes.starts_with(b"%PDF")})),
        "picture" => {
            let mut input = entry["input"].clone();
            if !input.is_object() {
                input = json!({});
            }
            if input.get("documentId").is_none() {
                input["documentId"] = json!(document.clone());
            }
            misty_page_runtime::picture(host, &input).await
        }
        "wait_for" => {
            let timeout = entry["timeoutMs"].as_u64().unwrap_or(5_000);
            misty_page_runtime::poll(host, &entry["input"], timeout).await
        }
        runtime => {
            let mut args = entry["args"].clone();
            if !args.is_object() {
                args = json!({});
            }
            if args.get("candidateId").is_none() {
                args["candidateId"] = json!(host.fresh_id());
            }
            if args.get("documentId").is_none() && !document.is_empty() {
                args["documentId"] = json!(document.clone());
            }
            host.call(None, runtime, args, false).await
        }
    }
}
