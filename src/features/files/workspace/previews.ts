/** Built-in readers shared by Files and Space resources. */
export { extractDocumentText } from "./explorer/components/globalPreview/previewDocument";
export const loadPdfPreview = () => import("./explorer/components/PdfViewerView");
