import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  PropertyList,
  Text,
} from "@/shared/ui";
import { MistyMarkdown } from "../../../runs/markdown/MistyMarkdown";
import { useCommandReport } from "./commandOutput";

/**
 * What an engine command reported — `/status`, `/stats`, `/hooks` and the like — shown the way
 * its terminal app prints it: sections of key and value rows, and text under them.
 */
export function CommandReportDialog() {
  const report = useCommandReport((s) => s.report);
  const close = useCommandReport((s) => s.close);
  return (
    <Dialog open={Boolean(report)} onOpenChange={(open) => !open && close()}>
      <DialogContent size="md" layout="scroll" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{report?.title ?? ""}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {report?.sections.map((section, index) => (
            <section key={`${section.heading ?? ""}:${index}`} className="mb-4 last:mb-0">
              {section.heading ? (
                <Text as="h3" size="meta" tone="muted" className="mb-1">
                  {section.heading}
                </Text>
              ) : null}
              {section.rows?.length ? (
                <PropertyList
                  label={section.heading ?? report.title}
                  items={section.rows.map((row, rowIndex) => ({
                    id: `${row.label}:${rowIndex}`,
                    label: row.label,
                    value: row.value,
                  }))}
                />
              ) : null}
              {section.text ? (
                <Text as="div" bare className="misty-markdown-message">
                  <MistyMarkdown>{section.text}</MistyMarkdown>
                </Text>
              ) : null}
            </section>
          ))}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
