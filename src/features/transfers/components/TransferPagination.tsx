import { Button } from "@/shared/ui";
import { transferStyles } from "../transferStyles";

export function TransferPagination(props: {
  activePageIndex: number;
  pageCount: number;
  transferCount: number;
  onPageChange: (pageIndex: number) => void;
}) {
  const empty = props.transferCount === 0;
  return (
    <div className={transferStyles.pagination}>
      <span className="tabular-nums">
        {empty
          ? "No transfers"
          : `Page ${props.activePageIndex + 1} of ${props.pageCount} · ${props.transferCount} transfers`}
      </span>
      <div className="flex gap-1.5">
        <Button
          variant="outline"
          size="sm"
          disabled={props.activePageIndex === 0 || empty}
          onClick={() => props.onPageChange(props.activePageIndex - 1)}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={props.activePageIndex + 1 >= props.pageCount || empty}
          onClick={() => props.onPageChange(props.activePageIndex + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
