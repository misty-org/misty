export const posts: BlogPost[] = [
  {
    title: "Introducing Misty — One App for All Your Cloud Files",
    date: "December 2025",
    summary:
      "We built Misty because managing files across Google Drive, OneDrive, and iCloud shouldn't require three different apps. Here's the story behind it.",
    tag: "Announcement",
  },
];

export const tagColors: Record<string, string> = {
  Announcement: "bg-charcoal-active text-cream-bright border-charcoal-active/20",
  Engineering: "bg-sage-bg text-sage-fg border-status-green/20",
};

export interface BlogPost {
  title: string;
  date: string;
  summary: string;
  tag: string;
}
