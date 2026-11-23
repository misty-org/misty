import { createHooks } from "@/shared/lib/seams";

export const accountResets = createHooks<[previousAccountId: string | undefined]>();

export const deviceDataErasers = createHooks();
