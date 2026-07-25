import { Badge } from "@/components/ui/badge";
import { STATUS_CLASSES, type AccountStatusTone } from "./accountTone";

export function AccountBadge({
  label,
  tone,
}: {
  label: string;
  tone: AccountStatusTone;
}) {
  return (
    <Badge
      variant="outline"
      className={`gap-1.5 rounded-md px-2 py-0.5 font-medium shadow-none ${STATUS_CLASSES[tone]}`}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {label}
    </Badge>
  );
}
