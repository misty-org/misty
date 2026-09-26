import type { MistyAppSDK } from "@misty/sdk";
import { MistyLspLanguageSchema } from "@misty/contracts";
import type { CodeLspTransport, LspMessage } from "./client";

/** A downloaded Code mount supplies its own SDK; native session ids stay in the host. */
export function createSdkCodeLspTransport(misty: Pick<MistyAppSDK, "code">): CodeLspTransport {
  return {
    async start(language, cwd) {
      return (await misty.code.lsp.start(MistyLspLanguageSchema.parse(language), cwd)).handle;
    },
    send: (handle, message) => misty.code.lsp.send(handle, JSON.stringify(message)),
    stop: (handle) => misty.code.lsp.stop(handle),
    subscribe: (handle, message, exited) =>
      misty.code.lsp.subscribe(handle, (event) => {
        if (event.type === "exit") exited(event.reason);
        else message(JSON.parse(event.payload) as LspMessage);
      }),
  };
}
