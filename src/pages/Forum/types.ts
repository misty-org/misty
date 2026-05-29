export interface Reply {
  author: string;
  avatar: string;
  date: string;
  body: string;
  likes: number;
}

export type Category =
  | "general"
  | "feature-requests"
  | "bug-reports"
  | "show-and-tell";

export interface Thread {
  id: number;
  title: string;
  category: Category;
  author: string;
  avatar: string;
  date: string;
  body: string;
  replies: Reply[];
  views: number;
  pinned?: boolean;
  solved?: boolean;
}

export type SortKey = "latest" | "popular" | "top";
