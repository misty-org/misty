import { ProductFrame } from "./ProductFrame";

const columns = [
  {
    title: "To do",
    tasks: [
      ["Confirm release date", "High"],
      ["Review launch brief", "Medium"],
    ],
  },
  {
    title: "In progress",
    tasks: [["Draft onboarding", "Medium"]],
  },
  {
    title: "Done",
    tasks: [["Collect research", "Done"]],
  },
];

export function TasksPreview() {
  return (
    <ProductFrame title="Launch plan" meta="Tasks · Board">
      <div
        role="region"
        aria-label="Task board preview"
        tabIndex={0}
        className="overflow-x-auto p-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-5"
      >
        <div className="grid min-h-[20rem] min-w-[32rem] grid-cols-3 gap-3">
          {columns.map((column, columnIndex) => (
            <div
              key={column.title}
              className="rounded-lg border border-border bg-muted/25 p-3"
            >
              <div className="mb-4 flex items-center justify-between">
                <p className="text-[11px] font-medium text-foreground">
                  {column.title}
                </p>
                <span className="text-xs text-muted-foreground">
                  {column.tasks.length}
                </span>
              </div>
              <div className="space-y-2">
                {column.tasks.map(([task, priority]) => (
                  <div
                    key={task}
                    className="rounded-md border border-border bg-background p-3 shadow-xs"
                  >
                    <p className="text-xs font-medium text-foreground">
                      {task}
                    </p>
                    <div className="mt-5 flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>{priority}</span>
                      <span>{columnIndex === 2 ? "Completed" : "Jul 24"}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </ProductFrame>
  );
}
