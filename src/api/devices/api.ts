import { managedAiRequest } from "@/api/ai/managed";

export const devicesApi = {
  request: managedAiRequest,
  list: <T>() => managedAiRequest<T>("/devices"),
  register: <T>(body: unknown, signal?: AbortSignal) =>
    managedAiRequest<T>("/devices", { method: "POST", body: JSON.stringify(body), signal }),
};
