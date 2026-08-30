export interface BlogPost {
  title: string;
  date: string;
  summary: string;
  tag: string;
  historicalContext?: string;
}

export const posts: BlogPost[] = [
  {
    title: "Introducing Misty — One app for All Your Cloud Files",
    date: "December 2025",
    summary:
      "We built Misty because managing files across Google Drive, OneDrive, and iCloud shouldn't require three different apps. Here's the story behind it.",
    tag: "Archive",
    historicalContext:
      "This post documents Misty's original file-first direction. Since then, Misty has expanded around shared Spaces for conversations, tasks, and a curated Library.",
  },
];

export const tagColors: Record<string, string> = {
  Announcement: "bg-primary/10 text-primary border-primary/20",
  Archive: "bg-muted text-foreground/75 border-border",
  Engineering: "bg-success/10 text-success border-success/20",
};
