import "./websiteLoader.css";

/** One quiet loading state for account setup and the first website navigation. */
export function WebsiteLoader() {
  return (
    <div className="website-loader" role="status" aria-label="Loading website">
      <span className="website-loader-spinner" aria-hidden="true" />
    </div>
  );
}
