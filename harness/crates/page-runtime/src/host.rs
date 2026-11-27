use serde_json::Value;
use std::future::Future;

pub enum Approval {
    Unasked,
    Allowed,
    Refused,
    Unanswered,
}

pub const CONSEQUENCE_KINDS: [&str; 4] = ["payment", "send", "delete", "publish"];

pub fn consequence_label(kind: &str) -> &'static str {
    match kind {
        "payment" => "pay or buy",
        "send" => "send a message",
        "delete" => "delete something",
        _ => "post or publish",
    }
}

pub trait PageHost: Sync {
    fn call(
        &self,
        frame: Option<u64>,
        operation: &str,
        args: Value,
        semantic: bool,
    ) -> impl Future<Output = Result<Value, String>> + Send;

    fn native(
        &self,
        input: Value,
        prepared: &Value,
    ) -> impl Future<Output = Result<Option<Value>, String>> + Send;

    fn approve(
        &self,
        kind: &str,
        control: &str,
        reason: &str,
    ) -> impl Future<Output = Approval> + Send;

    fn authorize(&self) -> Result<(), String>;

    fn sleep(&self, ms: u64) -> impl Future<Output = ()> + Send;

    fn fresh_id(&self) -> String;

    fn url(&self) -> Option<String>;

    fn go(&self, to: crate::navigation::Go<'_>) -> Result<(), String>;

    fn before_read(&self) -> impl Future<Output = Option<String>> + Send {
        async { None }
    }

    fn capture(
        &self,
        region: [f64; 4],
        image_width: f64,
        lossless: bool,
    ) -> impl Future<Output = Result<Value, String>> + Send {
        let _ = (region, image_width, lossless);
        async { Err("This host can't take pictures.".to_owned()) }
    }

    fn cookies(&self, request: Value) -> impl Future<Output = Result<Value, String>> + Send {
        let _ = request;
        async { Err("This host can't reach its cookies.".to_owned()) }
    }

    fn emulate(&self, request: Value) -> impl Future<Output = Result<Value, String>> + Send {
        let _ = request;
        async { Err("This host can't change its view.".to_owned()) }
    }

    fn resize(&self, size: Option<(f64, f64)>) -> impl Future<Output = Result<(), String>> + Send {
        let _ = size;
        async { Err("This host can't resize its page.".to_owned()) }
    }

    fn pdf(&self) -> impl Future<Output = Result<Vec<u8>, String>> + Send {
        async { Err("This host can't make a PDF.".to_owned()) }
    }

    fn holds_dialogs(&self) -> bool {
        false
    }

    fn hold_dialogs(&self, on: bool) -> impl Future<Output = ()> + Send {
        let _ = on;
        async {}
    }

    fn held_dialog(&self) -> impl Future<Output = Option<Value>> + Send {
        async { None }
    }

    fn answer_dialog(
        &self,
        accept: bool,
        text: Option<String>,
    ) -> impl Future<Output = Option<Value>> + Send {
        let _ = (accept, text);
        async { None }
    }

    fn downloads(&self) -> Vec<Value> {
        Vec::new()
    }

    fn frame_of(&self, reference: Option<&str>) -> Option<(u64, String)> {
        let _ = reference;
        None
    }

    fn point(&self, prepared: &Value) -> impl Future<Output = ()> + Send {
        let _ = prepared;
        async {}
    }

    fn open_address(&self, href: &str) -> bool {
        let _ = href;
        false
    }

    fn frames_show(&self, condition: &Value) -> impl Future<Output = bool> + Send {
        let _ = condition;
        async { false }
    }

    fn with_frame_trees(&self, snapshot: &mut Value) -> impl Future<Output = ()> + Send {
        let _ = snapshot;
        async {}
    }
}
