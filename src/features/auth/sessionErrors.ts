/** A saved account exists, but its session must be established again. */
export class SavedAccountSessionUnavailableError extends Error {
  name = "SavedAccountSessionUnavailableError";

  constructor(message = "This saved session is unavailable. Sign in again.") {
    super(message);
  }
}
