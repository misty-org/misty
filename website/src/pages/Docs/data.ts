export interface Endpoint {
  method: string;
  path: string;
  desc: string;
  curl: string;
  response: string;
}

export interface GuideSection {
  id: string;
  label: string;
  category: string;
  title: string;
  prose: string[];
  notes: { kind: "tip" | "note" | "warning"; text: string }[];
}

export interface ApiSection {
  id: string;
  label: string;
  category: string;
  title: string;
  badge?: string;
  description: string;
  endpoints: Endpoint[];
}

export type Section = GuideSection | ApiSection;

export interface Category {
  key: string;
  label: string;
  ids: string[];
}

/* ─── constants ─── */
export const methodColor: Record<string, string> = {
  GET: "text-green-400",
  POST: "text-zinc-400",
  PUT: "text-amber-400",
  DELETE: "text-red-400",
};
