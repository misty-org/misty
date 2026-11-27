use std::{collections::HashMap, sync::Mutex};

use crate::browser::*;

#[derive(Clone, Copy)]
struct Home {
    position: LogicalPosition<f64>,
    size: LogicalSize<f64>,
}

#[derive(Default)]
struct Sizes {
    asked: HashMap<String, (f64, f64)>,
    homes: HashMap<String, Home>,
}

fn sizes() -> &'static Mutex<Sizes> {
    static SIZES: std::sync::OnceLock<Mutex<Sizes>> = std::sync::OnceLock::new();
    SIZES.get_or_init(Default::default)
}

pub(in crate::browser) fn placed(
    webview: &Webview,
    position: LogicalPosition<f64>,
    size: LogicalSize<f64>,
) -> (LogicalPosition<f64>, LogicalSize<f64>, Option<f64>) {
    let Ok(mut sizes) = sizes().lock() else {
        return (position, size, None);
    };
    let label = webview.label().to_owned();
    sizes.homes.insert(label.clone(), Home { position, size });
    let Some(&asked) = sizes.asked.get(&label) else {
        return (position, size, None);
    };
    let fit = misty_page_runtime::fit([position.x, position.y, size.width, size.height], asked);
    let (width, height, zoom) = misty_page_runtime::snap(&fit, asked);
    (
        LogicalPosition::new(fit.x.round(), fit.y.round()),
        LogicalSize::new(width, height),
        Some(zoom),
    )
}

pub(crate) fn set(app: &AppHandle, webview: &Webview, size: Option<(f64, f64)>) -> Result<(), String> {
    let home = {
        let mut sizes = sizes().lock().map_err(|_| "Misty's page sizes are unavailable.")?;
        match size {
            Some(size) => {
                sizes.asked.insert(webview.label().to_owned(), size);
            }
            None => {
                sizes.asked.remove(webview.label());
            }
        }
        sizes.homes.get(webview.label()).copied()
    };
    let home = home.ok_or("The tab isn't on screen yet, so its size can't be set.")?;
    super::bounds::set_webview_bounds_if_changed(app, webview, home.position, home.size)?;
    if size.is_none() {
        super::native_page::set_zoom(webview, 1.0)?;
    }
    Ok(())
}

pub(crate) fn forget(label: &str) {
    if let Ok(mut sizes) = sizes().lock() {
        sizes.asked.remove(label);
        sizes.homes.remove(label);
    }
}
