import type { DesktopNavItem } from "@/application/layouts/model/types";
import type { AppTab } from "@/features/app-shell";
import { MobileLayout } from "@/application/layouts/MobileLayout";

export default function PlatformLayout(props: {
  getRouteId: (pathname: string) => AppTab;
  navItems: DesktopNavItem[];
}) {
  return <MobileLayout getRouteId={props.getRouteId} />;
}
