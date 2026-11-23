export type SpaceRole = "owner" | "member";

export type MessageSpan =
  | { type: "text"; text: string }
  | { type: "mention"; user_id: string; label: string }
  | { type: "mention"; agent_id: string; label: string }
  | { type: "mention"; role_id: string; label: string }
  | { type: "link"; label: string; url: string };
