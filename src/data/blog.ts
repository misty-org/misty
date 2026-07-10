export interface BlogPost {
  title: string;
  date: string;
  summary: string;
  tag: string;
}

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
  Announcement: "bg-primary/10 text-primary border-primary/20",
  Engineering: "bg-success/10 text-success border-success/20",
};
