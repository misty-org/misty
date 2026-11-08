import { useEffect, useState, type FormEvent } from "react";
import { profileSites, setProfileSites } from "./profileWindow";
import { Button, ErrorNotification, Skeleton, Textarea } from "@/shared/ui";
import { useDialogProfile } from "./profileDialogStore";

const sitesText = (sites: string[]) => sites.join("\n");

/** The sites whose links, from other apps, open in this profile, subdomains included. */
export function ProfileSiteLinks() {
  const profileId = useDialogProfile().id;
  const [saved, setSaved] = useState<string[] | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    void profileSites(profileId).then(
      (sites) => {
        if (!current) return;
        setSaved(sites);
        setDraft(sitesText(sites));
      },
      () => {
        if (!current) return;
        setSaved([]);
        setError("The sites for this profile couldn't be read.");
      },
    );
    return () => {
      current = false;
    };
  }, [profileId]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const sites = await setProfileSites(profileId, draft.split(/[\n,]/));
      setSaved(sites);
      setDraft(sitesText(sites));
    } catch (failure) {
      setError(typeof failure === "string" ? failure : "The sites couldn't be saved. Try again.");
    } finally {
      setSaving(false);
    }
  };
  const unchanged = saved !== null && draft.trim() === sitesText(saved);
  if (saved === null) return <Skeleton className="h-24 w-full rounded-md" />;
  return (
    <form className="grid gap-2" onSubmit={(event) => void save(event)}>
      <Textarea
        autoFocus
        aria-label="Sites for this profile, one per line"
        rows={4}
        placeholder="mail.example.com"
        disabled={saving}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <ErrorNotification message={error} onDismiss={() => setError("")} />
      <div className="flex items-center justify-end">
        <Button type="submit" disabled={saving || unchanged}>
          Save
        </Button>
      </div>
    </form>
  );
}
