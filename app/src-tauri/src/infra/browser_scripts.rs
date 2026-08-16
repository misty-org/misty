use url::Url;

pub(super) const BROWSER_VIEWPORT_SCRIPT: &str = r#"
(() => {
  const install = () => {
    if (document.getElementById('misty-browser-viewport-style')) return;
    const style = document.createElement('style');
    style.id = 'misty-browser-viewport-style';
    style.textContent = 'html, body { overscroll-behavior: none !important; }';
    (document.head || document.documentElement).appendChild(style);
  };

  const allowed = new Set([
    'default', 'pointer', 'text', 'vertical-text', 'crosshair', 'move', 'grab', 'grabbing',
    'not-allowed', 'wait', 'help', 'zoom-in', 'zoom-out', 'col-resize', 'row-resize',
    'n-resize', 'e-resize', 's-resize', 'w-resize', 'ne-resize', 'nw-resize', 'se-resize',
    'sw-resize', 'ew-resize', 'ns-resize', 'nesw-resize', 'nwse-resize', 'copy', 'alias',
    'context-menu', 'cell', 'progress'
  ]);
  let lastCursor = '';
  let pendingEvent = null;
  let frame = 0;

  const semanticCursor = (target) => {
    if (!(target instanceof Element)) return 'default';
    const computed = getComputedStyle(target).cursor;
    if (allowed.has(computed)) return computed;
    if (target.closest('a[href], button, summary, select, [role="button"], [role="link"], [onclick]')) {
      return 'pointer';
    }
    const editable = target.closest('textarea, [contenteditable="true"], input');
    if (editable && !/^(button|checkbox|color|file|image|radio|range|reset|submit)$/i.test(editable.type || '')) {
      return 'text';
    }
    return 'default';
  };

  const report = (cursor) => {
    const normalized = allowed.has(cursor) ? cursor : 'default';
    if (normalized === lastCursor) return;
    lastCursor = normalized;
    const signal = document.createElement('a');
    signal.href = `misty-cursor:${normalized}`;
    signal.hidden = true;
    document.documentElement?.appendChild(signal);
    signal.click();
    signal.remove();
  };

  const flush = () => {
    frame = 0;
    if (pendingEvent) report(semanticCursor(pendingEvent.target));
    pendingEvent = null;
  };
  const track = (event) => {
    pendingEvent = event;
    if (!frame) frame = requestAnimationFrame(flush);
  };

  install();
  report('default');
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  }
  document.addEventListener('pointerover', track, true);
  document.addEventListener('pointermove', track, true);
  document.addEventListener('pointerout', (event) => {
    if (!event.relatedTarget) report('default');
  }, true);
  window.addEventListener('blur', () => report('default'));
})();
"#;

pub(super) const BROWSER_FAVICON_SCRIPT: &str = r#"
(() => {
  const candidates = Array.from(document.querySelectorAll('link[rel][href]'))
    .map((link) => {
      const rel = String(link.rel || '').toLowerCase().split(/\s+/);
      const isIcon = rel.includes('icon') || rel.some((token) => token.includes('apple-touch-icon'));
      if (!isIcon || !/^https?:$/i.test(link.href ? new URL(link.href).protocol : '')) return null;
      const sizes = String(link.sizes?.value || link.getAttribute('sizes') || '').toLowerCase();
      const dimensions = Array.from(sizes.matchAll(/(\d+)x(\d+)/g));
      const largest = dimensions.reduce((value, match) => {
        return Math.max(value, Number(match[1]) || 0, Number(match[2]) || 0);
      }, 0);
      const vector = String(link.type || '').toLowerCase() === 'image/svg+xml' || /\.svg(?:$|[?#])/i.test(link.href);
      const scalable = sizes.includes('any');
      const standardIcon = rel.includes('icon') ? 100 : 0;
      return {
        href: link.href,
        score: vector ? 1_000_000 : scalable ? 900_000 : standardIcon + largest,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score);
  return candidates[0]?.href || null;
})()
"#;

pub(super) fn normalized_browser_cursor(value: &str) -> &'static str {
    match value {
        "pointer" => "pointer",
        "text" => "text",
        "vertical-text" => "vertical-text",
        "crosshair" => "crosshair",
        "move" => "move",
        "grab" => "grab",
        "grabbing" => "grabbing",
        "not-allowed" => "not-allowed",
        "wait" => "wait",
        "help" => "help",
        "zoom-in" => "zoom-in",
        "zoom-out" => "zoom-out",
        "col-resize" => "col-resize",
        "row-resize" => "row-resize",
        "n-resize" => "n-resize",
        "e-resize" => "e-resize",
        "s-resize" => "s-resize",
        "w-resize" => "w-resize",
        "ne-resize" => "ne-resize",
        "nw-resize" => "nw-resize",
        "se-resize" => "se-resize",
        "sw-resize" => "sw-resize",
        "ew-resize" => "ew-resize",
        "ns-resize" => "ns-resize",
        "nesw-resize" => "nesw-resize",
        "nwse-resize" => "nwse-resize",
        "copy" => "copy",
        "alias" => "alias",
        "context-menu" => "context-menu",
        "cell" => "cell",
        "progress" => "progress",
        _ => "default",
    }
}

pub(super) fn browser_cursor_navigation(url: &Url) -> Option<&'static str> {
    (url.scheme() == "misty-cursor")
        .then(|| normalized_browser_cursor(url.path().trim_start_matches('/')))
}

#[cfg(test)]
mod tests {
    use super::BROWSER_VIEWPORT_SCRIPT;

    #[test]
    fn cursor_reporting_does_not_enable_remote_desktop_ipc() {
        assert!(BROWSER_VIEWPORT_SCRIPT.contains("misty-cursor:"));
        assert!(!BROWSER_VIEWPORT_SCRIPT.contains("__TAURI_INTERNALS__"));
    }
}
