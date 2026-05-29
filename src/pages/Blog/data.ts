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
  {
    title: "How Misty Keeps Your Data Private by Design",
    date: "January 2026",
    summary:
      "Misty never stores your credentials or files externally. A deep dive into our local proxy architecture and why it matters.",
    tag: "Engineering",
  },
  {
    title: "Building a Cross-Platform Desktop App with ImGui and Go",
    date: "February 2026",
    summary:
      "Technical lessons from combining a C++ ImGui frontend with a Go Grpc backend — the trade-offs, the wins, and what we'd do differently.",
    tag: "Engineering",
  },
];

export const tagColors: Record<string, string> = {
  Announcement: "bg-primary/10 text-primary border-primary/20",
  Engineering: "bg-success/10 text-success border-success/20",
};
