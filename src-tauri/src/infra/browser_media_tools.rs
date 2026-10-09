//! Media and reading tools for the focused browser page: picture in picture,
//! play/pause from Misty's media controls and reader-mode article extraction.

use super::*;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserPictureInPictureRequest {
    pub id: String,
    /// "toggle", "enter" (only a playing video) or "exit".
    pub mode: String,
}

/// Picks the page's playing (else largest) video. WebKit's presentation mode is
/// preferred where it exists because it needs no promise; it enters synchronously
/// within the gesture the host grants this script.
const PICTURE_IN_PICTURE_SCRIPT: &str = r#"(() => {
  const mode = __MODE__;
  const videos = [...document.querySelectorAll("video")];
  const webkitActive = videos.find((v) => v.webkitPresentationMode === "picture-in-picture");
  if (document.pictureInPictureElement || webkitActive) {
    if (mode === "enter") return "active";
    if (webkitActive) webkitActive.webkitSetPresentationMode("inline");
    else document.exitPictureInPicture().catch(() => {});
    return "exited";
  }
  if (mode === "exit") return "inactive";
  const area = (v) => { const r = v.getBoundingClientRect(); return r.width * r.height; };
  const playing = (v) => !v.paused && !v.ended && v.readyState > 2;
  const candidates = videos
    .filter((v) => v.readyState > 0 && !v.disablePictureInPicture && (mode !== "enter" || playing(v)))
    .sort((a, b) => Number(playing(b)) - Number(playing(a)) || area(b) - area(a));
  const video = candidates[0];
  if (!video) return "none";
  if (typeof video.webkitSupportsPresentationMode === "function" &&
      video.webkitSupportsPresentationMode("picture-in-picture")) {
    video.webkitSetPresentationMode("picture-in-picture");
    return "entered";
  }
  if (document.pictureInPictureEnabled && typeof video.requestPictureInPicture === "function") {
    video.requestPictureInPicture().catch(() => {});
    return "entered";
  }
  return "unsupported";
})()"#;

/// Toggles picture-in-picture for the page's video. Entering needs a user
/// gesture: WebKit grants one to host-evaluated scripts, and on WebView2 the
/// DevTools Protocol evaluates with `userGesture`.
#[tauri::command]
pub async fn browser_webview_picture_in_picture(
    app: AppHandle,
    request: BrowserPictureInPictureRequest,
) -> Result<(), String> {
    let mode = match request.mode.as_str() {
        "toggle" | "enter" | "exit" => request.mode.as_str(),
        _ => return Err("Unknown picture-in-picture mode.".into()),
    };
    let webview = running_webview(&app, &request.id)?;
    let script = PICTURE_IN_PICTURE_SCRIPT.replace("__MODE__", &format!("{mode:?}"));
    #[cfg(windows)]
    {
        use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
        use windows::core::HSTRING;
        let parameters = serde_json::json!({
            "expression": script,
            "userGesture": true,
            "awaitPromise": false,
        })
        .to_string();
        return webview
            .with_webview(move |platform| unsafe {
                let Ok(core) = platform.controller().CoreWebView2() else {
                    return;
                };
                let handler =
                    CallDevToolsProtocolMethodCompletedHandler::create(Box::new(|_, _| Ok(())));
                let _ = core.CallDevToolsProtocolMethod(
                    &HSTRING::from("Runtime.evaluate"),
                    &HSTRING::from(parameters.as_str()),
                    &handler,
                );
            })
            .map_err(|error| error.to_string());
    }
    #[cfg(not(windows))]
    {
        eval_json(&webview, script).await.map(|_| ())
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserMediaPlaybackRequest {
    pub id: String,
    /// "pause" stops whatever plays and remembers it; "play" resumes only that.
    pub action: String,
}

const MEDIA_PLAYBACK_SCRIPT: &str = r#"(() => {
  const media = [...document.querySelectorAll("video, audio")];
  if (__PAUSE__) {
    media.filter((m) => !m.paused && !m.ended).forEach((m) => {
      m.dataset.mistyPaused = "1";
      m.pause();
    });
  } else {
    media.filter((m) => m.dataset.mistyPaused === "1").forEach((m) => {
      delete m.dataset.mistyPaused;
      m.play().catch(() => {});
    });
  }
})()"#;

/// Pauses or resumes a page's audio and video from the browser's media controls.
/// Resuming plays only what was paused this way, never media the page left paused.
#[tauri::command]
pub fn browser_webview_media_playback(
    app: AppHandle,
    request: BrowserMediaPlaybackRequest,
) -> Result<(), String> {
    let pause = match request.action.as_str() {
        "pause" => true,
        "play" => false,
        _ => return Err("Unknown media action.".into()),
    };
    running_webview(&app, &request.id)?
        .eval(MEDIA_PLAYBACK_SCRIPT.replace("__PAUSE__", if pause { "true" } else { "false" }))
        .map_err(|error| error.to_string())
}

/// Reader mode: the page's main article as plain structured blocks. Only text,
/// headings, lists, quotes, code and https images leave the page; the renderer
/// draws them itself, so no page markup or script is ever carried across.
const READER_ARTICLE_SCRIPT: &str = r#"(() => {
  const maxBlocks = 1500;
  const text = (el) => (el?.textContent || "").replace(/\s+/g, " ").trim();
  const paragraphText = (el) => {
    let total = 0;
    for (const p of el.querySelectorAll(":scope > p, :scope > div > p, :scope > section > p")) total += text(p).length;
    return total;
  };
  let root = document.querySelector("article");
  if (!root || text(root).length < 500) {
    let best = null, bestScore = 0;
    for (const el of document.querySelectorAll("main, article, section, div")) {
      const score = paragraphText(el);
      if (score > bestScore) { best = el; bestScore = score; }
    }
    root = best || document.body;
  }
  const skip = "nav, header, footer, aside, form, button, script, style, noscript, iframe, svg, template, [role=navigation], [aria-hidden=true], [hidden]";
  const blocks = [];
  const image = (img, caption) => {
    const src = img.currentSrc || img.src || "";
    if (/^https:/.test(src) && (img.naturalWidth || img.width || 0) >= 120)
      blocks.push({ type: "image", src: src.slice(0, 4096), alt: (img.alt || "").slice(0, 500), caption: (caption || "").slice(0, 1000) });
  };
  const walk = (el) => {
    for (const child of el.children) {
      if (blocks.length >= maxBlocks) return;
      if (child.matches(skip)) continue;
      const tag = child.tagName;
      if (/^H[1-6]$/.test(tag)) {
        const value = text(child);
        if (value) blocks.push({ type: "heading", level: Math.min(4, Math.max(2, Number(tag[1]))), text: value.slice(0, 1000) });
      } else if (tag === "P") {
        const value = text(child);
        if (value.length > 1) blocks.push({ type: "paragraph", text: value.slice(0, 20000) });
        for (const img of child.querySelectorAll("img")) image(img, "");
      } else if (tag === "BLOCKQUOTE") {
        const value = text(child);
        if (value) blocks.push({ type: "quote", text: value.slice(0, 20000) });
      } else if (tag === "PRE") {
        const value = child.textContent || "";
        if (value.trim()) blocks.push({ type: "code", text: value.slice(0, 20000) });
      } else if (tag === "UL" || tag === "OL") {
        const items = [...child.querySelectorAll(":scope > li")].map(text).filter(Boolean).slice(0, 200).map((item) => item.slice(0, 5000));
        if (items.length) blocks.push({ type: "list", ordered: tag === "OL", items });
      } else if (tag === "FIGURE") {
        const img = child.querySelector("img");
        if (img) image(img, text(child.querySelector("figcaption")));
      } else if (tag === "IMG") {
        image(child, "");
      } else {
        walk(child);
      }
    }
  };
  walk(root);
  const meta = (selector) => (document.querySelector(selector)?.getAttribute("content") || "").trim();
  const words = blocks.reduce((total, block) =>
    total + [block.text || "", ...(block.items || [])].join(" ").split(/\s+/).filter(Boolean).length, 0);
  return JSON.stringify({
    title: (meta('meta[property="og:title"]') || document.title || "").slice(0, 300),
    byline: meta('meta[name="author"]').slice(0, 200),
    site: (meta('meta[property="og:site_name"]') || location.hostname).slice(0, 200),
    url: location.href.slice(0, 4096),
    words,
    blocks,
  });
})()"#;

/// Extracts the page's article for reader mode.
#[tauri::command]
pub async fn browser_webview_reader_article(
    app: AppHandle,
    request: BrowserWebviewIdRequest,
) -> Result<Value, String> {
    let webview = running_webview(&app, &request.id)?;
    let value = eval_json(&webview, READER_ARTICLE_SCRIPT.to_owned()).await?;
    let article = serde_json::from_str::<Option<String>>(&value)
        .ok()
        .flatten()
        .filter(|article| article.len() <= 4 * 1024 * 1024)
        .ok_or_else(|| "This page has no article to read.".to_owned())?;
    serde_json::from_str(&article).map_err(|_| "This page has no article to read.".to_owned())
}
