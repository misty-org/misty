import { SystemErrorActivity } from "@/features/activity";
import type { ComponentProps } from "react";
import PdfViewerView from "./PdfViewerView";
export default function PdfViewer(props: Omit<ComponentProps<typeof PdfViewerView>, "Error">) {
  return <PdfViewerView {...props} Error={SystemErrorActivity} />;
}
