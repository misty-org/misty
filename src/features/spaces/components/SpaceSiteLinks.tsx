import { useEffect, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSpacesStore } from "@/features/spaces/core";
import { preferredDefaultSpace } from "@/features/spaces/defaultSpace";
import { isIncognitoWindow } from "@/features/workspace/spaceWindow";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button, Card, CardContent, CardHeader, CardTitle, Skeleton, Textarea } from "@/shared/ui";

const sitesText = (sites: string[]) => sites.join("\n");

/**
 * "Open these sites in this Space": links to these sites from other apps (Mail,
 * Messages, a chat app) open in this Space's window. The list is kept in the Space's
 * vault, so it follows the Space to every device.
 */
export function SpaceSiteLinks({ spaceId }: { spaceId: string }) {
  const personal = useSpacesStore(
    (state) => preferredDefaultSpace(state.spaces)?.id === spaceId,
  );
  const available = hasTauriInternals() && !isIncognitoWindow();
  const [saved, setSaved] = useState<string[] | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!available) return;
    let current = true;
    void invoke<string[]>("browser_sync_space_sites", { spaceId, personal }).then(
      (sites) => {
        if (!current) return;
        setSaved(sites);
        setDraft(sitesText(sites));
      },
      () => {
        if (!current) return;
        setSaved([]);
        setError("The sites for this Space couldn't be read.");
      },
    );
    return () => {
      current = false;
    };
  }, [available, personal, spaceId]);
  if (!available) return null;
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const sites = await invoke<string[]>("browser_sync_set_space_sites", {
        spaceId,
        personal,
        sites: draft.split(/[\n,]/),
      });
      setSaved(sites);
      setDraft(sitesText(sites));
    } catch (failure) {
      setError(typeof failure === "string" ? failure : "The sites couldn't be saved. Try again.");
    } finally {
      setSaving(false);
    }
  };
  const unchanged = saved !== null && draft.trim() === sitesText(saved);
  return (
    <Card aria-labelledby="space-sites-heading">
      <CardHeader>
        <CardTitle id="space-sites-heading">Open these sites in this Space</CardTitle>
        <p className="mb-0 mt-1 text-xs text-cream-muted">
          Links to these sites from other apps open in this Space's window, subdomains included.
          Other links open in the Space you used last. The list is kept in this Space's
          encrypted vault and follows it to your other devices.
        </p>
      </CardHeader>
      <CardContent>
        {saved === null ? (
          <Skeleton className="h-24 w-full max-w-lg rounded-md" />
        ) : (
          <form className="grid max-w-lg gap-2" onSubmit={(event) => void save(event)}>
            <Textarea
              aria-label="Sites for this Space, one per line"
              rows={4}
              placeholder="mail.example.com"
              disabled={saving}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <div className="flex items-center justify-end">
              <Button type="submit" disabled={saving || unchanged}>
                Save
              </Button>
            </div>
          </form>
        )}
        {error ? (
          <p role="alert" className="mb-0 mt-3 text-xs text-cream">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
