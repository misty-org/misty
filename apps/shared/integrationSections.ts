/** Curated website destinations; route input can select only these known URLs. */
const sections: Record<string, readonly (readonly [string, string, string])[]> =
  {
    google: [
      ["inbox", "Inbox", "https://mail.google.com/mail/u/0/#inbox"],
      ["starred", "Starred", "https://mail.google.com/mail/u/0/#starred"],
      ["sent", "Sent", "https://mail.google.com/mail/u/0/#sent"],
      ["drafts", "Drafts", "https://mail.google.com/mail/u/0/#drafts"],
    ],
    "google-drive": [
      ["files", "My Drive", "https://drive.google.com/drive/u/0/my-drive"],
      [
        "shared",
        "Shared with me",
        "https://drive.google.com/drive/u/0/shared-with-me",
      ],
      ["recent", "Recent", "https://drive.google.com/drive/u/0/recent"],
      ["starred", "Starred", "https://drive.google.com/drive/u/0/starred"],
      ["trash", "Trash", "https://drive.google.com/drive/u/0/trash"],
    ],
    dropbox: [
      ["files", "All files", "https://www.dropbox.com/home"],
      ["shared", "Shared", "https://www.dropbox.com/share"],
      ["deleted", "Deleted files", "https://www.dropbox.com/deleted_files"],
    ],
    todoist: [
      ["inbox", "Inbox", "https://app.todoist.com/app/inbox"],
      ["today", "Today", "https://app.todoist.com/app/today"],
      ["upcoming", "Upcoming", "https://app.todoist.com/app/upcoming"],
    ],
    "google-calendar": [
      [
        "agenda",
        "Schedule",
        "https://calendar.google.com/calendar/u/0/r/agenda",
      ],
      ["week", "Week", "https://calendar.google.com/calendar/u/0/r/week"],
      ["month", "Month", "https://calendar.google.com/calendar/u/0/r/month"],
    ],
  };
export function integrationSections(provider: string) {
  return sections[provider] ?? [];
}
export function integrationSectionUrl(provider: string, route: string) {
  const section = new URL(route, "https://misty.local").searchParams.get(
    "section",
  );
  return integrationSections(provider).find(([id]) => id === section)?.[2];
}
