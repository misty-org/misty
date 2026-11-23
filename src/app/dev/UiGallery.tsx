import { Text } from "@misty/ui";
import { BarsSection } from "./gallery/BarsSection";
import { ButtonsSection } from "./gallery/ButtonsSection";
import { ChoicesSection } from "./gallery/ChoicesSection";
import { FeedbackSection } from "./gallery/FeedbackSection";
import { FormsSection } from "./gallery/FormsSection";
import { KeysAndCodeSection } from "./gallery/KeysAndCodeSection";
import { MenusSection } from "./gallery/MenusSection";
import { OverlaysSection } from "./gallery/OverlaysSection";
import { PatternsSection } from "./gallery/PatternsSection";
import { RichRowsSection } from "./gallery/RichRowsSection";
import { RowsSection } from "./gallery/RowsSection";
import { StructureSection } from "./gallery/StructureSection";
import { TypeSection } from "./gallery/TypeSection";
import { WorkspaceSection } from "./gallery/WorkspaceSection";

export default function UiGallery() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-5xl gap-10 px-6 py-8">
        <Text as="h1" size="title" weight="semibold" tone="bright">
          UI gallery
        </Text>
        <TypeSection />
        <ButtonsSection />
        <MenusSection />
        <RowsSection />
        <RichRowsSection />
        <FormsSection />
        <KeysAndCodeSection />
        <PatternsSection />
        <ChoicesSection />
        <BarsSection />
        <WorkspaceSection />
        <OverlaysSection />
        <FeedbackSection />
        <StructureSection />
      </div>
    </div>
  );
}
