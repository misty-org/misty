import { ButtonsSection } from "./gallery/ButtonsSection";
import { FeedbackSection } from "./gallery/FeedbackSection";
import { FormsSection } from "./gallery/FormsSection";
import { MenusSection } from "./gallery/MenusSection";
import { OverlaysSection } from "./gallery/OverlaysSection";

/** Dev-only catalog of every shared UI component. The reference for how Misty looks. */
export default function UiGallery() {
  return (
    <div className="mx-auto grid max-w-5xl gap-10 px-6 py-8 text-cream">
      <header className="grid gap-1">
        <h1 className="m-0 text-lg font-semibold text-cream-bright">UI gallery</h1>
        <p className="m-0 text-sm text-cream-muted">
          Every shared component from <code>@/shared/ui</code>. Features compose these; they never
          restyle them.
        </p>
      </header>
      <ButtonsSection />
      <MenusSection />
      <FormsSection />
      <OverlaysSection />
      <FeedbackSection />
    </div>
  );
}
