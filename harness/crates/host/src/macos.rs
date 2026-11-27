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
    Ask(super::scenario::Ask),
    Finished(Result<(), String>),
    Held,
}

type Slot =
    std::sync::Arc<std::sync::Mutex<Option<std::sync::mpsc::Sender<Result<String, String>>>>>;
type Waiting = std::rc::Rc<std::cell::RefCell<Vec<Slot>>>;

fn take_slot(slot: &Slot) -> Option<std::sync::mpsc::Sender<Result<String, String>>> {
    slot.lock().ok().and_then(|mut kept| kept.take())
}

fn waiting_reply(
    waiting: &Waiting,
    reply: std::sync::mpsc::Sender<Result<String, String>>,
) -> impl Fn(Result<String, String>) + Send + 'static {
    let slot: Slot = std::sync::Arc::new(std::sync::Mutex::new(Some(reply)));
    waiting
        .borrow_mut()
        .retain(|kept| kept.lock().is_ok_and(|kept| kept.is_some()));
    waiting.borrow_mut().push(slot.clone());
    move |result| {
        if let Some(reply) = take_slot(&slot) {
            let _ = reply.send(result);
        }
    }
}

pub fn run() -> Result<(), String> {
    let options = super::options()?;
    let scenario = match &options.scenario {
        Some(path) => Some(super::scenario::read(path)?),
        None => None,
    };
    let start = scenario
        .as_ref()
        .map(|scenario| scenario.start.clone())
        .unwrap_or_else(|| options.url.clone());
    let event_loop = EventLoopBuilder::<HostEvent>::with_user_event().build();
    let window = WindowBuilder::new()
        .with_title("misty-browser-harness")
        .with_inner_size(LogicalSize::new(1280.0, 800.0))
        .build(&event_loop)
        .map_err(|error| error.to_string())?;
    let proxy = event_loop.create_proxy();
    let loads = proxy.clone();
    let webview = WebViewBuilder::new()
        .with_url(&start)
        .with_initialization_script(misty_page_runtime::PAGE)
        .with_initialization_script(misty_page_runtime::WEBMCP)
        .with_on_page_load_handler(move |event, url| {
            if matches!(event, PageLoadEvent::Finished) {
                let _ = loads.send_event(HostEvent::Loaded(url));
            }
        })
        .build(&window)
        .map_err(|error| error.to_string())?;
    let mtm = MainThreadMarker::new().ok_or("the host must start on the main thread")?;
    misty_page_runtime::macos::dialogs::install(&webview.webview());
    let held_proxy = std::sync::Mutex::new(proxy.clone());
    misty_page_runtime::macos::dialogs::on_held(move |_| {
        if let Ok(proxy) = held_proxy.lock() {
            let _ = proxy.send_event(HostEvent::Held);
        }
    });
    let waiting: Waiting = Default::default();
    // SAFETY: on the main thread, with a plain world name.
    let world = unsafe { WKContentWorld::worldWithName(&NSString::from_str(WORLD), mtm) };
    let mut asked = false;
    let mut scenario = scenario;
    let mut pending_load: Option<std::sync::mpsc::Sender<Result<String, String>>> = None;

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            Event::UserEvent(HostEvent::Loaded(url)) if scenario.is_some() && !asked => {
                asked = true;
                eprintln!("harness-host: loaded {url}");
                let Some(scenario) = scenario.take() else {
                    return;
                };
                let asks = std::sync::Mutex::new(proxy.clone());
                let done = proxy.clone();
                std::thread::spawn(move || {
                    let host = super::scenario::ScenarioHost::new(move |ask| {
                        if let Ok(proxy) = asks.lock() {
                            let _ = proxy.send_event(HostEvent::Ask(ask));
                        }
                    });
                    let result = super::scenario::run(&host, &scenario);
                    let _ = done.send_event(HostEvent::Finished(result));
                });
            }
            Event::UserEvent(HostEvent::Loaded(url)) if asked && options.scenario.is_some() => {
                if let Some(reply) = pending_load.take() {
                    let _ = reply.send(Ok(url));
                }
            }
            Event::UserEvent(HostEvent::Ask(ask)) => match ask {
                super::scenario::Ask::Capture(region, image_width, lossless, reply) => {
                    let [x, y, width, height] = region;
                    misty_page_runtime::macos::capture(
                        mtm,
                        &webview.webview(),
                        misty_page_runtime::macos::Region { x, y, width, height },
                        image_width,
                        lossless,
                        move |result| {
                            let _ = reply.send(result.map(|value| value.to_string()));
                        },
                    );
                }
                super::scenario::Ask::Cookies(request, reply) => {
                    misty_page_runtime::macos::cookies(&webview.webview(), request, move |result| {
                        let _ = reply.send(result.map(|value| value.to_string()));
                    });
                }
                super::scenario::Ask::Emulate(request, reply) => {
                    let result = misty_page_runtime::macos::emulate(&webview.webview(), &request);
                    let _ = reply.send(result.map(|value| value.to_string()));
                }
                super::scenario::Ask::Resize(size, reply) => {
                    let room = window.inner_size().to_logical::<f64>(window.scale_factor());
                    let fit = match size {
                        Some(size) => misty_page_runtime::fit([0.0, 0.0, room.width, room.height], size),
                        None => misty_page_runtime::Fit { x: 0.0, y: 0.0, width: room.width, height: room.height, scale: 1.0 },
                    };
                    misty_page_runtime::macos::place(&webview.webview(), &fit, size);
                    let result = Ok("null".to_owned());
                    let _ = reply.send(result);
                }
                super::scenario::Ask::Pdf(reply) => {
                    misty_page_runtime::macos::pdf(&webview.webview(), move |result| {
                        let _ = reply.send(result);
                    });
                }
                super::scenario::Ask::Native(input, reply) => {
                    let result = misty_page_runtime::macos::perform(mtm, &webview.webview(), &input);
                    let _ = reply.send(Ok(result.to_string()));
                }
                super::scenario::Ask::Fire(js) => {
                    if let Err(error) = webview.evaluate_script(&js) {
                        eprintln!("harness-host: {error}");
                    }
                }
                super::scenario::Ask::World(body, reply) => {
                    if misty_page_runtime::macos::dialogs::held(&webview.webview()).is_some() {
                        let _ = reply.send(Err(misty_page_runtime::DIALOG_HELD.to_owned()));
                        return;
                    }
                    call_in_world(&webview.webview(), &world, &body, waiting_reply(&waiting, reply));
                }
                super::scenario::Ask::Dialogs(request, reply) => {
                    let view = webview.webview();
                    let answer = if let Some(on) = request["hold"].as_bool() {
                        misty_page_runtime::macos::dialogs::hold(&view, on);
                        serde_json::Value::Null
                    } else if let Some(accept) = request["answer"].as_bool() {
                        misty_page_runtime::macos::dialogs::answer(&view, accept, request["text"].as_str())
                            .unwrap_or(serde_json::Value::Null)
                    } else {
                        misty_page_runtime::macos::dialogs::held(&view).unwrap_or(serde_json::Value::Null)
                    };
                    let _ = reply.send(Ok(answer.to_string()));
                }
                super::scenario::Ask::Page(js, reply) => {
                    if misty_page_runtime::macos::dialogs::held(&webview.webview()).is_some() {
                        let _ = reply.send(Err(misty_page_runtime::DIALOG_HELD.to_owned()));
                        return;
                    }
                    let reply = waiting_reply(&waiting, reply);
                    let wrapped = format!("(() => {{ try {{ return JSON.stringify((() => {{ {js} }})() ?? null); }} catch (error) {{ return JSON.stringify({{ pageError: String(error) }}); }} }})()");
                    if let Err(error) = webview.evaluate_script_with_callback(&wrapped, move |raw| {
                        let text = serde_json::from_str::<String>(&raw).unwrap_or(raw);
                        reply(Ok(text));
                    }) {
                        eprintln!("harness-host: {error}");
                    }
                }
                super::scenario::Ask::Load(url, reply) => {
                    pending_load = Some(reply);
                    if let Err(error) = webview.load_url(&url) {
                        if let Some(reply) = pending_load.take() {
                            let _ = reply.send(Err(error.to_string()));
                        }
                    }
                }
            },
            Event::UserEvent(HostEvent::Held) => {
                for slot in waiting.borrow_mut().drain(..) {
                    if let Some(reply) = take_slot(&slot) {
                        let _ = reply.send(Err(misty_page_runtime::DIALOG_HELD.to_owned()));
                    }
                }
            }
            Event::UserEvent(HostEvent::Finished(result)) => {
                if let Err(error) = result {
                    eprintln!("harness-host: {error}");
                    std::process::exit(1);
                }
                if !options.keep_open {
                    *control_flow = ControlFlow::Exit;
                }
            }
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
