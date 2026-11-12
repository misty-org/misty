import { createHooks } from "@/shared/lib/seams";

/** Features that keep state per account clear it here when the account changes or signs out. */
export const accountResets = createHooks<[previousAccountId: string | undefined]>();

/** Features that keep browsing data on this computer erase it here when the person asks. */
export const deviceDataErasers = createHooks();
