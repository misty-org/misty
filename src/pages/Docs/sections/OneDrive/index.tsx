import SectionBody from "../../SectionBody";
import type { SectionData } from "../../types";

export { data } from "./data";

export default function OneDrive({ section }: { section: SectionData }) {
  return <SectionBody section={section} />;
}
