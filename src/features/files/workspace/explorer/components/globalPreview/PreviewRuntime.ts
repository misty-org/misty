import type { ComponentProps, ComponentType, RefObject } from "react";
import type { SystemErrorActivity } from "@/features/activity";
import type {
  GlobalPreviewSource,
  PreviewResource,
} from "../../model/interfaces/components/GlobalPreview";
export type PreviewErrorComponent = ComponentType<ComponentProps<typeof SystemErrorActivity>>;
export interface PreviewRuntime {
  Error: PreviewErrorComponent;
  load(source: GlobalPreviewSource, signal: AbortSignal): Promise<PreviewResource>;
  save(source: GlobalPreviewSource, bytes: Uint8Array, copy: boolean): Promise<string>;
  open(source: GlobalPreviewSource): Promise<unknown>;
  useSaveShortcut(save: () => void, enabled: boolean, element: RefObject<HTMLElement | null>): void;
}
