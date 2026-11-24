let directCheck: (spaceId: string) => boolean = () => false;

export function provideDirectSpaceCheck(check: (spaceId: string) => boolean) {
  directCheck = check;
}

const id = (value: string) => encodeURIComponent(value);

export function attachmentUploadsPath(spaceId: string): string {
  return directCheck(spaceId)
    ? `/dms/${id(spaceId)}/attachments/uploads`
    : `/spaces/${id(spaceId)}/library/uploads`;
}

export function attachmentDownloadPath(spaceId: string, attachmentId: string): string {
  const base = directCheck(spaceId) ? `/dms/${id(spaceId)}` : `/spaces/${id(spaceId)}`;
  return `${base}/attachments/${id(attachmentId)}/download`;
}
