import { PageHeader, PublicPage } from "@/components/marketing";

/**
 * Shared shell for the three legal documents. Every one of them is a stub until
 * real, reviewed text is published — the copy here states that plainly and
 * makes no commitments on Misty's behalf.
 */
export default function LegalPage({
  title,
  summary,
}: {
  title: string;
  summary: string;
}) {
  return (
    <PublicPage>
      <PageHeader label="Legal" title={title} description={summary} />

      <div className="mx-auto max-w-3xl pt-12">
        <p className="text-base leading-7 text-muted-foreground">
          This document has not been published yet. It will appear here before
          Misty leaves beta.
        </p>
      </div>
    </PublicPage>
  );
}
