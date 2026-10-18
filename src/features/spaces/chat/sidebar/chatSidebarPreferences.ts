const key = "misty:chat-sidebar-collapsed";

/** Which chat sidebar sections are collapsed: a per-viewer convenience, so storage may be absent. */
export function readChatSidebar(): Record<string, boolean> {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

export function writeChatSidebar(value: Record<string, boolean>) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The sections still collapse for this session.
  }
}
