import { type ReactNode } from "react";

export interface RenderErrorBoundaryProps {
  children: ReactNode;
}

export interface RenderErrorBoundaryState {
  error: Error | null;
}
