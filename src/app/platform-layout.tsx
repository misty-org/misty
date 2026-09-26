import type { DesktopNavItem } from "@/app/layouts/model/types";
import type { AppTab } from "@/features/app-shell";
import { DesktopLayout } from "@/app/layouts/DesktopLayout";

export default function PlatformLayout(props: {
  getRouteId: (pathname: string) => AppTab;
  navItems: DesktopNavItem[];
}) {
  return <DesktopLayout {...props} />;
}
