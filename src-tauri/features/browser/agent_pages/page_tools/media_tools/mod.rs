//! Reading tools for a page: reader-mode article extraction. The script that keeps a page's
//! media keys lives in `session`.

use super::*;

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

// What a page is playing, and its own media controls.
pub(crate) mod session;
