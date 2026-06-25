import type { MistyAppSDK } from "@misty/sdk";
import type { SpaceNote } from "@misty/contracts";
export async function checkMethodInference(sdk: MistyAppSDK) {
  const note: SpaceNote = await sdk.server.call("notes.get", {
    path: { noteID: "note-a" },
  });
  const title: string = note.title;
  // @ts-expect-error An app cannot choose an arbitrary result type.
  await sdk.server.call<{ invented: number }>("notes.list");
  // @ts-expect-error A required resource path cannot be omitted.
  await sdk.server.call("notes.get");
  // @ts-expect-error Cross-method identifiers are rejected.
  await sdk.server.call("notes.get", { path: { taskID: "task-a" } });
  await sdk.server.call("tasks.update", {
    path: { taskID: "task-a" },
    // @ts-expect-error Updates need the concurrency version.
    body: { title: "Task" },
  });
  // @ts-expect-error Billing is not a downloaded-app capability.
  await sdk.server.call("billing.checkout");
  // @ts-expect-error Title belongs to collaborative editing, not note metadata.
  await sdk.notes.update("note-a", { title: "Changed" });
  return title;
}
