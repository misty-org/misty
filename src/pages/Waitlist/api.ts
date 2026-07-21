import type { WaitlistFormState } from "./types";
import { apiBase } from "../../lib/apiBase";

export async function submitWaitlist(formData: WaitlistFormState) {
  const response = await fetch(`${apiBase}/waitlist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(formData),
  });

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("Too many requests. Please wait a moment and try again.");
    }

    throw new Error("We couldn't submit your request. Please try again.");
  }
}
