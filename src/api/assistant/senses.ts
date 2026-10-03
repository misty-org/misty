import { apiRequest } from "@/api/client";

/** A user-facing model choice. Misty's own keys run every model. */
export type SenseId = "thinking" | "seeing" | "browsing" | "listening" | "speaking";

/** A Gateway model that fits a sense. */
export interface SenseModel {
  id: string;
  name: string;
  provider: string;
  /** The account's plan cannot use this model; paid plans can. */
  paid_only?: boolean;
}

export interface ModelSense {
  id: SenseId;
  name: string;
  description: string;
  /** The account's choice; empty means Misty's default. */
  model: string;
  default_model: string;
  options: SenseModel[];
}

export const sensesApi = {
  list: () => apiRequest<{ senses: ModelSense[] }>("/ai/senses"),
  /** An empty model returns the sense to Misty's default. */
  set: (sense: SenseId, model: string) =>
    apiRequest<void>(`/ai/senses/${encodeURIComponent(sense)}`, {
      method: "PUT",
      body: JSON.stringify({ model }),
    }),
};
