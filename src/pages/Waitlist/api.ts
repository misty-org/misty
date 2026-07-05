import type { WaitlistFormState } from "./types";
import { apiBase } from "../../lib/apiBase";

export async function submitWaitlist(formData: WaitlistFormState) {
  const response = await fetch(`${apiBase}/waitlist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(formData),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Submission failed");
  }
}
