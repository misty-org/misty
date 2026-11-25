import type { ComponentType } from "react";
import { createPort } from "@/shared/lib/seams";

export const memberFace =
  createPort<ComponentType<{ spaceId: string; userId: string; name: string }>>(
    "a Space member's face",
  );
