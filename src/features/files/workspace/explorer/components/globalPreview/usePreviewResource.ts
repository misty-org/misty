import { useCallback, useEffect, useState } from "react";
import { errorText } from "@/shared/lib/format";
import type {
  GlobalPreviewSource,
  PreviewResource,
} from "../../model/interfaces/components/GlobalPreview";
import type { PreviewRuntime } from "./PreviewRuntime";
export function usePreviewResource(source: GlobalPreviewSource, load: PreviewRuntime["load"]) {
  const [resource, setResource] = useState<PreviewResource | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(async () => {
    setRevision((value) => value + 1);
  }, []);
  useEffect(() => {
    const lifetime = new AbortController();
    let objectUrl: string | undefined;
    setLoading(true);
    setLoadError(null);
    setResource(null);
    void load(source, lifetime.signal)
      .then((loaded) => {
        const url = loaded.url?.startsWith("blob:") ? loaded.url : undefined;
        if (lifetime.signal.aborted) {
          if (url) URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setResource(loaded);
      })
      .catch((reason) => {
        if (!lifetime.signal.aborted) setLoadError(errorText(reason));
      })
      .finally(() => {
        if (!lifetime.signal.aborted) setLoading(false);
      });
    return () => {
      lifetime.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [revision, source, load]);
  return { resource, loading, loadError, reload };
}
