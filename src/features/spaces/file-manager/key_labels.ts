// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
import { desktopOs } from "@/shared/platform/desktop_os";

const mac = desktopOs() === "macos";

export const keys = {
  open: mac ? "⌘O" : "Enter",
  quickLook: "Space",
  info: mac ? "⌘I" : "Alt+Enter",
  rename: mac ? "Return" : "F2",
  duplicate: mac ? "⌘D" : "Ctrl+D",
  copy: mac ? "⌘C" : "Ctrl+C",
  cut: mac ? "⌘X" : "Ctrl+X",
  paste: mac ? "⌘V" : "Ctrl+V",
  copyPath: mac ? "⌥⌘C" : "Ctrl+Alt+C",
  reveal: mac ? "⌘R" : "Ctrl+R",
  trash: mac ? "⌘⌫" : "Delete",
  deleteNow: mac ? "⌥⌘⌫" : "Shift+Delete",
  newFolder: mac ? "⇧⌘N" : "Ctrl+Shift+N",
  goToFolder: mac ? "⇧⌘G" : "Ctrl+Shift+G",
  undo: mac ? "⌘Z" : "Ctrl+Z",
  redo: mac ? "⇧⌘Z" : "Ctrl+Y",
  back: mac ? "⌘[" : "Alt+Left",
  forward: mac ? "⌘]" : "Alt+Right",
  up: mac ? "⌘↑" : "Alt+Up",
  search: mac ? "⌘F" : "Ctrl+F",
} as const;

export const isMac = mac;
