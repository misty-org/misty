import { globalMistyApi } from "./globalMistyApi";
import { ApiRequestError } from "@/api/client";

const KEY = "misty.pendingServerChatDeletes";

function read(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function write(ids: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // Nothing to keep the list in: the server row simply stays until it is deleted again.
  }
}

/** Chats deleted here whose server row could not be reached; sync skips and retries them. */
export const pendingServerDeletes = {
  has: (id: string) => read().includes(id),
  /** Deletes the chat's server row; if the server is down, remembers it for the next sync. */
  async delete(id: string) {
    try {
      await globalMistyApi.deleteConversation(id);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) return;
      const ids = read();
      if (!ids.includes(id)) write([...ids, id]);
      return;
    }
    write(read().filter((item) => item !== id));
  },
  async retry() {
    for (const id of read()) await this.delete(id);
  },
};
