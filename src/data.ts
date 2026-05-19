export interface Endpoint {
  method: string;
  path: string;
  desc: string;
  curl: string;
  response: string;
}

export interface Step {
  heading: string;
  text: string;
  screenshot?: string | null; // string = real src, null = placeholder box, undefined = no image
}

export interface GuideSection {
  id: string;
  label: string;
  category: string;
  title: string;
  prose: string[];
  notes: { kind: "tip" | "note" | "warning"; text: string }[];
  steps?: Step[];
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
