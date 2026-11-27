use std::{cell::RefCell, collections::HashMap};

use serde_json::{json, Value};
use tauri::Webview;
use tokio::sync::oneshot::Receiver;
use gtk::prelude::WidgetExt;
use webkit2gtk::{
    CookieManagerExt, PrintOperationExt, ScriptDialog, ScriptDialogType, SnapshotOptions,
    SnapshotRegion, WebViewExt, WebsiteDataManagerExt,
};

use super::{clip, cookie_action, cookie_applies, data_url, reply, same_site, COOKIE_VALUE_LIMIT};

type Started<T> = Result<Receiver<Result<T, String>>, String>;

fn on_view<T: Send + 'static>(
    view: &Webview,
    work: impl FnOnce(&webkit2gtk::WebView, &str, Box<dyn FnOnce(Result<T, String>) + Send>) + Send + 'static,
) -> Started<T> {
    let (done, receiver) = reply::<T>();
    let label = view.label().to_owned();
    view.with_webview(move |platform| work(&platform.inner(), &label, Box::new(done)))
        .map_err(|error| error.to_string())?;
    Ok(receiver)
}

fn crop(
    surface: gtk::cairo::Surface,
    source: [f64; 4],
    width: i32,
    height: i32,
) -> Result<(u32, u32, Vec<u8>), String> {
    use gtk::cairo::{Context, Format, ImageSurface};
    let snapshot = ImageSurface::try_from(surface).map_err(|_| "WebKit returned an unreadable picture.".to_owned())?;
    let [x, y, source_width, _] = source;
    let scale = f64::from(width) / source_width.max(1.0);
    let mut copy = ImageSurface::create(Format::ARgb32, width.max(1), height.max(1)).map_err(|error| error.to_string())?;
    {
        let context = Context::new(&copy).map_err(|error| error.to_string())?;
        context.scale(scale, scale);
        context.set_source_surface(&snapshot, -x, -y).map_err(|error| error.to_string())?;
        context.paint().map_err(|error| error.to_string())?;
    }
    copy.flush();
    let stride = copy.stride() as usize;
    let data = copy.data().map_err(|error| error.to_string())?;
    let (columns, rows) = (width.max(1) as usize, height.max(1) as usize);
    let mut rgba = Vec::with_capacity(columns * rows * 4);
    for row in 0..rows {
        for pixel in data[row * stride..row * stride + columns * 4].chunks_exact(4) {
            let word = u32::from_ne_bytes([pixel[0], pixel[1], pixel[2], pixel[3]]);
            let alpha = (word >> 24) as u8;
            let straight = |channel: u32| -> u8 {
                let channel = (channel & 0xff) as u8;
                if alpha == 0 || alpha == 255 {
                    channel
                } else {
                    ((u32::from(channel) * 255 + u32::from(alpha) / 2) / u32::from(alpha)).min(255) as u8
                }
            };
            rgba.extend_from_slice(&[straight(word >> 16), straight(word >> 8), straight(word), alpha]);
        }
    }
    Ok((columns as u32, rows as u32, rgba))
}

fn encode(width: u32, height: u32, rgba: Vec<u8>, lossless: bool) -> Result<Vec<u8>, String> {
    let image = image::RgbaImage::from_raw(width, height, rgba).ok_or("The picture's size didn't match its pixels.")?;
    let mut out = std::io::Cursor::new(Vec::new());
    if lossless {
        image.write_to(&mut out, image::ImageFormat::Png).map_err(|error| error.to_string())?;
    } else {
        image::DynamicImage::ImageRgba8(image)
            .to_rgb8()
            .write_to(&mut out, image::ImageFormat::Jpeg)
            .map_err(|error| error.to_string())?;
    }
    Ok(out.into_inner())
}

pub(super) fn capture(view: &Webview, region: [f64; 4], image_width: f64, lossless: bool) -> Started<Value> {
    on_view(view, move |view, _, done| {
        let [x, y, width, height] = region;
        if ![x, y, width, height, image_width].iter().all(|n| n.is_finite()) || width < 1.0 || height < 1.0 {
            return done(Err("Capture region is invalid.".into()));
        }
        let css_width = f64::from(view.allocated_width().max(1)) / view.zoom_level().max(0.01);
        view.snapshot(SnapshotRegion::Visible, SnapshotOptions::NONE, None::<&gtk::gio::Cancellable>, move |shot| {
            let result = shot
                .map_err(|error| format!("WebKit couldn't take the picture: {error}"))
                .and_then(|surface| {
                    let pixels = gtk::cairo::ImageSurface::try_from(surface.clone())
                        .map(|image| f64::from(image.width()) / css_width)
                        .unwrap_or(1.0);
                    let out_width = image_width.round() as i32;
                    let out_height = (height * image_width / width).round() as i32;
                    crop(surface, [x * pixels, y * pixels, width * pixels, height * pixels], out_width, out_height)
                })
                .and_then(|(columns, rows, rgba)| {
                    let bytes = encode(columns, rows, rgba, lossless)?;
                    Ok(json!({"dataUrl": data_url(&bytes, lossless), "width": columns, "height": rows}))
                });
            done(result);
        });
    })
}

fn described(cookie: &mut soup::Cookie) -> Value {
    let mut out = json!({
        "name": cookie.name().map(|name| name.to_string()).unwrap_or_default(),
        "value": clip(cookie.value().as_deref().unwrap_or(""), COOKIE_VALUE_LIMIT),
        "domain": cookie.domain().map(|domain| domain.to_string()).unwrap_or_default(),
        "path": cookie.path().map(|path| path.to_string()).unwrap_or_default(),
        "httpOnly": cookie.is_http_only(),
        "secure": cookie.is_secure(),
    });
    if let Some(expires) = cookie.expires() {
        out["expires"] = json!(expires.to_unix());
    }
    out["sameSite"] = json!(match cookie.same_site_policy() {
        soup::SameSitePolicy::Lax => "lax",
        soup::SameSitePolicy::Strict => "strict",
        _ => "none",
    });
    out
}

pub(super) fn cookies(view: &Webview, request: Value) -> Started<Value> {
    on_view(view, move |view, _, done| {
        let action = match cookie_action(&request) {
            Ok(action) => action.to_owned(),
            Err(error) => return done(Err(error)),
        };
        let Some(manager) = view.website_data_manager().and_then(|data| data.cookie_manager()) else {
            return done(Err("This page has no cookie store.".into()));
        };
        if action == "set" {
            let (Some(name), Some(domain)) = (
                request["name"].as_str().filter(|name| !name.is_empty()),
                request["domain"].as_str().filter(|domain| !domain.is_empty()),
            ) else {
                return done(Err("A cookie needs a name and a domain.".into()));
            };
            let policy = match same_site(&request) {
                Ok(policy) => policy,
                Err(error) => return done(Err(error)),
            };
            let mut cookie = soup::Cookie::new(
                name,
                request["value"].as_str().unwrap_or(""),
                domain,
                request["path"].as_str().unwrap_or("/"),
                -1,
            );
            cookie.set_http_only(request["httpOnly"] == true);
            cookie.set_secure(request["secure"] == true);
            if let Some(policy) = policy {
                cookie.set_same_site_policy(match policy {
                    "Lax" => soup::SameSitePolicy::Lax,
                    "Strict" => soup::SameSitePolicy::Strict,
                    _ => soup::SameSitePolicy::None,
                });
            }
            if let Some(when) = request["expires"].as_f64().and_then(|at| webkit2gtk::glib::DateTime::from_unix_utc(at as i64).ok()) {
                cookie.set_expires(&when);
            }
            let shown = described(&mut cookie);
            manager.add_cookie(&mut cookie, None::<&gtk::gio::Cancellable>, move |added| {
                done(added.map(|()| json!({"ok": true, "cookie": shown})).map_err(|error| error.to_string()));
            });
            return;
        }
        let Some(address) = view.uri() else {
            return done(Err("The page has no address yet.".into()));
        };
        let keeper = manager.clone();
        manager.cookies(&address, None::<&gtk::gio::Cancellable>, move |found| {
            let found = match found {
                Ok(found) => found,
                Err(error) => return done(Err(error.to_string())),
            };
            let whole = action == "clear";
            let mut picked: Vec<(soup::Cookie, Value)> = found
                .into_iter()
                .map(|mut cookie| {
                    let shown = described(&mut cookie);
                    (cookie, shown)
                })
                .filter(|(_, shown)| cookie_applies(shown, &request, whole))
                .collect();
            if action == "list" || action == "get" {
                let listed: Vec<Value> = picked.into_iter().map(|(_, shown)| shown).collect();
                return done(Ok(json!({"ok": true, "cookies": listed})));
            }
            let removed = picked.len();
            for (cookie, _) in &mut picked {
                keeper.delete_cookie(cookie, None::<&gtk::gio::Cancellable>, |_| {});
            }
            done(Ok(json!({"ok": true, "removed": removed})));
        });
    })
}

pub(super) fn emulate(view: &Webview, request: Value) -> Started<Value> {
    on_view(view, move |_, _, done| {
        if request["colorScheme"].is_string() || request["media"].as_str().is_some_and(|media| media != "screen") {
            return done(Err(
                "WebKitGTK sets no color scheme or print media for one page; only its size can be changed here."
                    .into(),
            ));
        }
        done(Ok(json!({"ok": true, "colorScheme": "no-preference", "media": "screen"})));
    })
}

pub(super) fn pdf(view: &Webview) -> Started<Vec<u8>> {
    on_view(view, move |view, label, done| {
        let path = std::env::temp_dir().join(format!("misty-page-{}-{}.pdf", label.replace(['/', '\\'], "-"), uuid::Uuid::new_v4()));
        let settings = gtk::PrintSettings::new();
        settings.set_printer("Print to File");
        settings.set(gtk::PRINT_SETTINGS_OUTPUT_FILE_FORMAT, Some("pdf"));
        settings.set(gtk::PRINT_SETTINGS_OUTPUT_URI, Some(&format!("file://{}", path.display())));
        let operation = webkit2gtk::PrintOperation::new(view);
        operation.set_print_settings(&settings);
        let done = std::rc::Rc::new(RefCell::new(Some(done)));
        let failed = done.clone();
        let printed = path.clone();
        operation.connect_finished(move |_| {
            if let Some(done) = done.borrow_mut().take() {
                let bytes = std::fs::read(&printed).map_err(|_| "WebKitGTK wrote no PDF.".to_owned());
                let _ = std::fs::remove_file(&printed);
                done(bytes);
            }
        });
        operation.connect_failed(move |_, error| {
            if let Some(done) = failed.borrow_mut().take() {
                done(Err(format!("WebKitGTK couldn't make the PDF: {error}")));
            }
        });
        operation.print();
    })
}

pub(super) fn set_zoom(view: &Webview, zoom: f64) -> Result<(), String> {
    view.with_webview(move |platform| platform.inner().set_zoom_level(zoom))
        .map_err(|error| error.to_string())
}

struct Held {
    kind: &'static str,
    message: String,
    default_text: Option<String>,
    dialog: ScriptDialog,
}

#[derive(Default)]
struct Tab {
    installed: bool,
    holding: bool,
    held: Option<Held>,
}

thread_local! {
    static TABS: RefCell<HashMap<String, Tab>> = RefCell::new(HashMap::new());
}

pub(super) fn hold_dialogs(view: &Webview, on: bool) -> Started<()> {
    on_view(view, move |view, label, done| {
        let installed = TABS.with(|tabs| tabs.borrow().get(label).is_some_and(|tab| tab.installed));
        if !installed {
            let own = label.to_owned();
            view.connect_script_dialog(move |_, dialog| {
                let holding = TABS.with(|tabs| tabs.borrow().get(&own).is_some_and(|tab| tab.holding && tab.held.is_none()));
                if !holding {
                    return false;
                }
                let kind = match dialog.dialog_type() {
                    ScriptDialogType::Alert => "alert",
                    ScriptDialogType::Prompt => "prompt",
                    ScriptDialogType::BeforeUnloadConfirm => "beforeunload",
                    _ => "confirm",
                };
                let held = Held {
                    kind,
                    message: dialog.message().map(|text| text.chars().take(500).collect()).unwrap_or_default(),
                    default_text: (kind == "prompt").then(|| dialog.prompt_get_default_text().map(|text| text.to_string())).flatten(),
                    dialog: dialog.clone(),
                };
                TABS.with(|tabs| tabs.borrow_mut().entry(own.clone()).or_default().held = Some(held));
                super::dialog_held();
                true
            });
            TABS.with(|tabs| tabs.borrow_mut().entry(label.to_owned()).or_default().installed = true);
        }
        TABS.with(|tabs| tabs.borrow_mut().entry(label.to_owned()).or_default().holding = on);
        done(Ok(()));
    })
}

pub(super) fn held_dialog(view: &Webview) -> Started<Option<Value>> {
    on_view(view, |_, label, done| {
        done(Ok(TABS.with(|tabs| {
            tabs.borrow().get(label).and_then(|tab| tab.held.as_ref()).map(|held| {
                let mut described = json!({"kind": held.kind, "message": held.message, "held": true});
                if let Some(text) = &held.default_text {
                    described["defaultText"] = json!(text);
                }
                described
            })
        })))
    })
}

pub(super) fn answer_dialog(view: &Webview, accept: bool, text: Option<String>) -> Started<Option<Value>> {
    on_view(view, move |_, label, done| {
        let Some(held) = TABS.with(|tabs| tabs.borrow_mut().get_mut(label).and_then(|tab| tab.held.take())) else {
            return done(Ok(None));
        };
        let mut answered = json!({"kind": held.kind, "message": held.message, "accepted": accept || held.kind == "alert"});
        match held.kind {
            "prompt" if accept => {
                let given = text.or(held.default_text).unwrap_or_default();
                held.dialog.prompt_set_text(&given);
                answered["text"] = json!(given);
            }
            "confirm" | "beforeunload" => held.dialog.confirm_set_confirmed(accept),
            _ => {}
        }
        held.dialog.close();
        done(Ok(Some(answered)));
    })
}
