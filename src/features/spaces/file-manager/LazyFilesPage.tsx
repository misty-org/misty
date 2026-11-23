import { lazyTool, ToolSuspense } from "@misty/ui";

const FilesPage = lazyTool(async () => {
  const { FilesPage } = await import("./FilesPage");
  return { default: FilesPage };
});

export function LazyFilesPage() {
  return (
    <ToolSuspense tool="files" label="Checking access to your files">
      <FilesPage />
    </ToolSuspense>
  );
}
