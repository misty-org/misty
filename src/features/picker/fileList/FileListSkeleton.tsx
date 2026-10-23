import { fileListStyles } from "./fileListStyles";

const rows = Array.from({ length: 12 }, (_, index) => index);
const columns = [0, 1, 2, 3];

export function FileListSkeleton() {
  return (
    <section
      className={`${fileListStyles.browser} ${fileListStyles.browserLoading}`}
      aria-busy="true"
      aria-label="Directory"
    >
      <div className={fileListStyles.tableSkeleton} aria-hidden="true">
        <div
          className={`${fileListStyles.tableSkeletonLine} ${fileListStyles.tableSkeletonHeader}`}
        >
          {columns.map((index) => (
            <span
              className={`${fileListStyles.skeletonCell} ${fileListStyles.tableSkeletonHeaderCell}`}
              key={index}
            />
          ))}
        </div>
        {rows.map((index) => (
          <div
            className={`${fileListStyles.tableSkeletonLine} ${fileListStyles.tableSkeletonRow}`}
            key={index}
          >
            {columns.map((column) => (
              <span
                className={`${fileListStyles.skeletonCell} ${fileListStyles.tableSkeletonCell}`}
                key={column}
              />
            ))}
          </div>
        ))}
      </div>
      <footer className={fileListStyles.footer} aria-hidden="true">
        <span className={`${fileListStyles.skeletonCell} h-3 w-24`} />
      </footer>
    </section>
  );
}
