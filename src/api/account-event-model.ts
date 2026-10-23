/** An invalidation the server publishes for an account: a topic and, optionally, the id that changed. */
export interface AccountEvent {
  topic: string;
  id?: string;
}
export type Subscriber = (event: AccountEvent) => void;

export function validEvent(value: unknown): value is AccountEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as AccountEvent;
  return (
    [
      "reset",
      "runs",
      "invocations",
      "jobs",
      "agents",
      "interventions",
      "workflows",
      "usage",
      "library-renditions",
      "device-pairing",
      "devices",
    ].includes(event.topic) &&
    (event.id === undefined || (typeof event.id === "string" && event.id.length <= 200))
  );
}
