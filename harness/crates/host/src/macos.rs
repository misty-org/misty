//! The macOS host: a tao window with a wry WKWebView. The runtime runs in a named
//! `WKContentWorld`, which shares the page's DOM but not its JavaScript, through WebKit's own
//! `callAsyncJavaScript`.
use block2::RcBlock;
use objc2::{rc::Retained, runtime::AnyObject, MainThreadMarker};
use objc2_foundation::{NSError, NSString};
use objc2_web_kit::{WKContentWorld, WKWebView};
use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder},
    window::WindowBuilder,
};
use wry::{PageLoadEvent, WebViewBuilder, WebViewExtMacOS};

/// The script world the runtime lives in, the one Misty's agent pages use.
const WORLD: &str = "misty-agent-page";

enum HostEvent {
    Loaded(String),
    Answer(Result<String, String>),
}

pub fn run() -> Result<(), String> {
    let options = super::options()?;
    let event_loop = EventLoopBuilder::<HostEvent>::with_user_event().build();
    let window = WindowBuilder::new()
        .with_title("misty-browser-harness")
        .with_inner_size(LogicalSize::new(1280.0, 800.0))
        .build(&event_loop)
        .map_err(|error| error.to_string())?;
    let proxy = event_loop.create_proxy();
    let loads = proxy.clone();
    let webview = WebViewBuilder::new()
        .with_url(&options.url)
        .with_on_page_load_handler(move |event, url| {
            if matches!(event, PageLoadEvent::Finished) {
                let _ = loads.send_event(HostEvent::Loaded(url));
            }
        })
        .build(&window)
        .map_err(|error| error.to_string())?;
    let mtm = MainThreadMarker::new().ok_or("the host must start on the main thread")?;
    // SAFETY: on the main thread, with a plain world name.
    let world = unsafe { WKContentWorld::worldWithName(&NSString::from_str(WORLD), mtm) };
    let mut asked = false;

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            // The first finished load answers; later ones (frames, client redirects) don't ask again.
            Event::UserEvent(HostEvent::Loaded(url)) if !asked => {
                asked = true;
                eprintln!("harness-host: loaded {url}");
                let body = misty_page_runtime::call_body(&options.operation, &options.args);
                let answers = proxy.clone();
                call_in_world(&webview.webview(), &world, &body, move |result| {
                    let _ = answers.send_event(HostEvent::Answer(result));
                });
            }
            Event::UserEvent(HostEvent::Answer(result)) => {
                match result {
                    Ok(json) => println!("{}", readable(&json)),
                    Err(error) => {
                        eprintln!("harness-host: {error}");
                        std::process::exit(1);
                    }
                }
                if !options.keep_open {
                    *control_flow = ControlFlow::Exit;
                }
            }
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => *control_flow = ControlFlow::Exit,
            _ => {}
        }
    })
}

/// Runs `body` as an async function in `world` of the page's main frame. The answer is the
/// string the function returns.
fn call_in_world(
    view: &WKWebView,
    world: &Retained<WKContentWorld>,
    body: &str,
    done: impl Fn(Result<String, String>) + 'static,
) {
    let handler = RcBlock::new(move |value: *mut AnyObject, error: *mut NSError| {
        let result = if !error.is_null() {
            // SAFETY: WebKit passes a valid NSError when it passes one at all.
            let message = unsafe { &*error }.localizedDescription();
            Err(format!("the page could not run the runtime: {message}"))
        } else if value.is_null() {
            Ok("null".to_owned())
        } else if let Some(text) = unsafe { &*value }.downcast_ref::<NSString>() {
            Ok(text.to_string())
        } else {
            Err("the runtime returned something other than a string".to_owned())
        };
        done(result);
    });
    // SAFETY: called on the main thread with no arguments dictionary, as WebKit requires.
    unsafe {
        view.callAsyncJavaScript_arguments_inFrame_inContentWorld_completionHandler(
            &NSString::from_str(body),
            None,
            None,
            world,
            Some(&*handler),
        );
    }
}

/// The runtime's JSON answer, indented when it parses, with a snapshot's tree as its own lines.
fn readable(json: &str) -> String {
    match serde_json::from_str::<serde_json::Value>(json) {
        Ok(mut value) => {
            let tree = value
                .get_mut("tree")
                .and_then(|tree| tree.as_str().map(str::to_owned));
            if let (Some(tree), Some(object)) = (tree, value.as_object_mut()) {
                object.remove("tree");
                let rest = serde_json::to_string_pretty(&value).unwrap_or_default();
                return format!("{rest}\n{tree}");
            }
            serde_json::to_string_pretty(&value).unwrap_or_else(|_| json.to_owned())
        }
        Err(_) => json.to_owned(),
    }
}
