let mode: "tab" | "peek" = "tab";

/** Account setting: links from other apps open as a tab, or in Peek over the current page. */
export function configureExternalLinks(value: string): void {
  mode = value === "peek" ? "peek" : "tab";
}

export function externalLinkMode(): "tab" | "peek" {
  return mode;
}
