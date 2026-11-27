import type { Misty } from "@misty/sdk";
import type { MistyPage } from "./page_misty";

export async function pageMisty(spaceId: string, page: MistyPage): Promise<Misty> {
  const { pageMisty: open } = await import("./page_misty");
  return open(spaceId, page);
}
