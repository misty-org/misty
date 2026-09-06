import type { DesktopNavItem } from "@/application/layouts/model/types";
import type { AppTab } from "@/features/app-shell";
import { DesktopLayout } from "@/application/layouts/DesktopLayout";

export default function PlatformLayout(props: {
  getRouteId: (pathname: string) => AppTab;
  navItems: DesktopNavItem[];
}) {
  return <DesktopLayout {...props} />;
}
