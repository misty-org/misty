import "@/styles/styles.css";
import type { ComponentType } from "react";
import type { OfficialAppPackageMountProps } from "./types";

export interface DesktopAppComponent {
  apiVersion: 1;
  appId: string;
  Component: ComponentType<OfficialAppPackageMountProps>;
}

export function defineDesktopApp(
  appId: string,
  Component: DesktopAppComponent["Component"],
): DesktopAppComponent {
  return { apiVersion: 1, appId, Component };
}
