import { Button } from "@/ui";
import { Component, type ErrorInfo, type ReactNode } from "react";

export interface RenderErrorBoundaryProps {
  children: ReactNode;
}

export interface RenderErrorBoundaryState {
  error: Error | null;
}
