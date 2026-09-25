/** Page text is only a display hint; it never establishes account identity. */
export function providerPageTitle(title: string, platform: string): string {
  let value = title.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
  const messaging =
    /^(Instagram|Gmail|Outlook|Slack|Discord|Messenger|Teams|Microsoft Teams|Yahoo Mail|iCloud Mail)$/i.test(
      platform,
    );
  if (messaging) value = value.replace(/^\(\d[\d,]*\)\s*/, "");
  const brands = new Set([platform.toLocaleLowerCase()]);
  if (platform === "Gmail") brands.add("google mail");
  if (platform === "Microsoft Teams") brands.add("teams");
  const parts = value.split(/\s+[·•|—–-]\s+|\s*[·•]\s*/);
  while (parts.length && brands.has(parts[0].trim().toLocaleLowerCase()))
    parts.shift();
  while (
    parts.length &&
    brands.has(parts[parts.length - 1].trim().toLocaleLowerCase())
  )
    parts.pop();
  // Gmail appends the mailbox address to its title. It is not account evidence.
  if (
    platform === "Gmail" &&
    parts.length > 1 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parts[parts.length - 1].trim())
  )
    parts.pop();
  value = parts.join(" · ").trim();
  if (messaging)
    value = value.replace(
      /^(Inbox|Messages|Mail|Direct messages)\s*\([\d,]+\)/i,
      "$1",
    );
  return value.slice(0, 160);
}
export function providerNavigationTitles(input: {
  platform: string;
  title: string;
  url: string;
  inPlatform: boolean;
  accountLabel?: string;
}) {
  const page = input.inPlatform
    ? providerPageTitle(input.title, input.platform)
    : "";
  let host = "";
  try {
    host = new URL(input.url).hostname;
  } catch {
    /* Starting view. */
  }
  const detail = input.inPlatform ? page : host;
  const account = input.accountLabel?.trim();
  const suffix = account ? ` · ${account}` : "";
  return {
    page: page || input.platform,
    tab: (detail ? `${detail} · ${input.platform}` : input.platform) + suffix,
    header:
      (detail ? `${input.platform} · ${detail}` : input.platform) + suffix,
  };
}

/** Keep recognizable provider unread counts outside editable label text. */
export function providerUnreadCount(
  title: string,
  platform: string,
): string | undefined {
  if (
    !/^(Instagram|Gmail|Outlook|Slack|Discord|Messenger|Teams|Microsoft Teams|Yahoo Mail|iCloud Mail)$/i.test(
      platform,
    )
  )
    return;
  return (
    title.match(/^\((\d[\d,]*)\)\s*/)?.[1] ??
    title.match(/^(?:Inbox|Messages|Mail|Direct messages)\s*\(([\d,]+)\)/i)?.[1]
  );
}
