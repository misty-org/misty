import { directApi } from "../api";

const ROOM_CHECK_MS = 5_000;

export interface CallRoomCheck {
  people?: string[];
  full: boolean;
}

const isFull = (error: unknown) =>
  Boolean(
    error && typeof error === "object" && (error as { code?: unknown }).code === "room_full",
  );

export function checkCallRoom(room: string): Promise<CallRoomCheck> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ full: false }), ROOM_CHECK_MS);
    directApi
      .callToken(room)
      .then(
        ({ people }) =>
          Array.isArray(people)
            ? {
                full: false,
                people: people.filter((id): id is string => typeof id === "string"),
              }
            : { full: false },
        (error: unknown) => ({ full: isFull(error) }),
      )
      .then((check) => {
        clearTimeout(timer);
        resolve(check);
      });
  });
}
