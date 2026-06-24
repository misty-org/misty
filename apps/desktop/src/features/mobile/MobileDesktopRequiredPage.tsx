import { Monitor } from "lucide-react";

export function MobileDesktopRequiredPage(props: { feature: string }) {
  return (
    <section className="mobile-page mobile-desktop-required">
      <div className="mobile-desktop-required-card">
        <Monitor size={34} strokeWidth={1.8} />
        <span>Desktop only</span>
        <h2>{props.feature} is not available on mobile yet.</h2>
        <p>Misty mobile is intentionally simplified for v1. Use the desktop app for this workflow.</p>
      </div>
    </section>
  );
}
