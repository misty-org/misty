import type { ComponentProps, ComponentType } from "react";
import type { SystemErrorNotice } from "@/features/support/systemErrors";
export type PreviewErrorComponent = ComponentType<ComponentProps<typeof SystemErrorNotice>>;
