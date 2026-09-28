export interface PageDocument {
  html: string;
  width: number;
  height: number;
}
export function snapshotPage(root: Element): PageDocument | null;
