export type TransferActionFeedback = {
  tone: "busy" | "success" | "error";
  text: string;
} | null;
