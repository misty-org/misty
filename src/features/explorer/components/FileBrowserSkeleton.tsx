import type { ExplorerViewMode } from "@/stores/explorer";
import { fileBrowserStyles } from "./FileBrowserStyles";

export function FileBrowserSkeleton(props: { viewMode: ExplorerViewMode }) {
  const rows = Array.from({ length: 12 }, (_, index) => index);
  const tiles = Array.from({ length: 20 }, (_, index) => index);

  return (
    <section
      className={`${fileBrowserStyles.browser} ${fileBrowserStyles.browserLoading}`}
      aria-busy="true"
      aria-label="Loading directory"
    >
      {props.viewMode === "grid" ? (
        <div className={fileBrowserStyles.gridSkeleton} aria-hidden="true">
          {tiles.map((index) => (
            <span
              className={`${fileBrowserStyles.skeletonCell} ${fileBrowserStyles.gridSkeletonCell}`}
              key={index}
            />
          ))}
        </div>
      ) : (
        <div className={fileBrowserStyles.tableSkeleton} aria-hidden="true">
          <div
            className={`${fileBrowserStyles.tableSkeletonLine} ${fileBrowserStyles.tableSkeletonHeader}`}
          >
            <span
              className={`${fileBrowserStyles.skeletonCell} ${fileBrowserStyles.tableSkeletonHeaderCell}`}
            />
            <span
              className={`${fileBrowserStyles.skeletonCell} ${fileBrowserStyles.tableSkeletonHeaderCell}`}
            />
            <span
              className={`${fileBrowserStyles.skeletonCell} ${fileBrowserStyles.tableSkeletonHeaderCell}`}
            />
            <span
              className={`${fileBrowserStyles.skeletonCell} ${fileBrowserStyles.tableSkeletonHeaderCell}`}
            />
          </div>
          {rows.map((index) => (
            <div
              className={`${fileBrowserStyles.tableSkeletonLine} ${fileBrowserStyles.tableSkeletonRow}`}
              key={index}
            >
              <span
                className={`${fileBrowserStyles.skeletonCell} ${fileBrowserStyles.tableSkeletonCell}`}
              />
              <span
                className={`${fileBrowserStyles.skeletonCell} ${fileBrowserStyles.tableSkeletonCell}`}
              />
              <span
                className={`${fileBrowserStyles.skeletonCell} ${fileBrowserStyles.tableSkeletonCell}`}
              />
              <span
                className={`${fileBrowserStyles.skeletonCell} ${fileBrowserStyles.tableSkeletonCell}`}
              />
            </div>
          ))}
        </div>
      )}
      <footer className={fileBrowserStyles.footer}>Loading directory...</footer>
    </section>
  );
}
