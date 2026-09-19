import { createInlineRewrite } from "./createInlineRewrite";
import { openMisty } from "@/features/misty/handoff";
export const InlineRewrite = createInlineRewrite({openMisty:()=>openMisty({prompt:"Help me change this code."}),report:console.error});
