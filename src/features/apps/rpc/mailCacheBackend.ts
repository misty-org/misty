import { readApiAuthToken } from "@/api/client/session";
import { mailCacheRead, mailCacheWrite, mailCacheRemove } from "@/native/runtime";
import type { MailCacheBackend } from "./mailCache";

/** Native storage receives ciphertext and an opaque namespace, never component-chosen paths. */
export function createMailCacheBackend(serverBase: string): MailCacheBackend {
  return {
    serverBase,
    readSecret: readApiAuthToken,
    read: mailCacheRead,
    write: mailCacheWrite,
    remove: mailCacheRemove,
  };
}
