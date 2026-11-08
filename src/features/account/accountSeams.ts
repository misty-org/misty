import { createHooks, createPort } from "@/shared/lib/seams";

/** Features that keep state per account clear it here when the account changes or signs out. */
export const accountResets = createHooks<[previousAccountId: string | undefined]>();

/** Features that keep browsing data on this computer erase it here when the person asks. */
export const deviceDataErasers = createHooks();

/** Saves the memory export as a file and answers with its name (memory is on this computer). */
export const memoryExport = createPort<(now: Date) => Promise<string>>("the memory export");
