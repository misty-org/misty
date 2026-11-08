/** What the browser hands to Ask about a page: the page text, selection and where it came from. */
export interface BrowserAskSnapshot {
  id: string;
  scopeId: string;
  spaceId?: string | null;
  profileId?: string | null;
  providerId?: string | null;
  revision: string;
  contentHash: string;
  intent?: "ask";
  page: {
    url: string;
    title: string;
    content: string;
    selection: boolean;
    editable: boolean;
    link: string;
    image: string;
    documentRevision: string;
  };
}
