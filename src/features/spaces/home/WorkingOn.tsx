import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button, Input, OverflowFadeText, Skeleton, useNotice } from "@/shared/ui";
import { useSpacesStore } from "../list/useSpacesStore";
import {
  activeClaims,
  claimBody,
  claimMaxLength,
  overlappingClaim,
  postedAgo,
} from "../handoffs/spacePosts";
import { OverviewCard } from "./OverviewCard";

/**
 * What the members of a Space said they are working on, in their own words. A claim is a
 * message its person posts in the Space chat; it can be released and stops showing after a
 * day. Typing one that overlaps someone else's shows a warning and never stops the post.
 */
export function WorkingOn({ spaceId, me }: { spaceId: string; me: string }) {
  const messages = useSpacesStore((state) => state.messagesBySpace[spaceId]);
  const readOnly = useSpacesStore((state) => state.referenceOnly);
  const [now, setNow] = useState(() => Date.now());
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const store = useSpacesStore.getState();
    if (!store.messagesBySpace[spaceId] && !store.referenceOnly) void store.loadMessages(spaceId);
  }, [spaceId]);
  // Claims expire while the page stays open.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });

  const claims = useMemo(() => activeClaims(messages ?? [], now), [messages, now]);
  const overlap = useMemo(() => overlappingClaim(draft, claims, me), [draft, claims, me]);

  const post = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim() || busy) return;
    setBusy("post");
    setError("");
    try {
      await useSpacesStore.getState().sendMessage(spaceId, claimBody(draft));
      setDraft("");
      setNow(Date.now());
    } catch {
      setError("That couldn't be posted. Try again.");
    } finally {
      setBusy("");
    }
  };
  const release = async (claimId: string) => {
    setBusy(claimId);
    setError("");
    try {
      await useSpacesStore.getState().deleteMessage(spaceId, claimId);
    } catch {
      setError("That couldn't be released. Try again.");
    } finally {
      setBusy("");
    }
  };

  return (
    <OverviewCard title="Working on" count={claims.length}>
      {!messages && !readOnly ? (
        <div className="grid gap-2 px-2.5 py-2" aria-hidden="true">
          <Skeleton className="h-3 w-3/5" />
          <Skeleton className="h-3 w-2/5" />
        </div>
      ) : (
        <ul className="m-0 grid list-none p-0">
          {claims.map((claim) => (
            <li key={claim.id} className="flex min-h-9 min-w-0 items-center gap-2 px-2.5 py-1">
              <OverflowFadeText full className="min-w-0 flex-1 text-sm text-cream-muted">
                <span className="text-cream">{claim.userId === me ? "You" : claim.name}</span>
                {" · "}
                {claim.text}
              </OverflowFadeText>
              <span className="shrink-0 text-xs text-cream-muted">
                {postedAgo(claim.createdAt, now)}
              </span>
              {claim.userId === me && !readOnly ? (
                <Button
                  type="button"
                  variant="quiet"
                  disabled={busy === claim.id}
                  onClick={() => void release(claim.id)}
                >
                  Release
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {readOnly ? null : (
        <form className="flex items-center gap-2 px-1 pb-1 pt-1.5" onSubmit={(e) => void post(e)}>
          <Input
            aria-label="What you are working on"
            placeholder="What are you working on?"
            className="min-w-0 flex-1"
            value={draft}
            maxLength={claimMaxLength}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" variant="secondary" disabled={!draft.trim() || busy !== ""}>
            Post
          </Button>
        </form>
      )}
      {overlap ? (
        <p className="m-0 px-2.5 pb-1.5 text-xs text-tone-amber" role="status">
          {overlap.name} is working on “{overlap.text}”. You can still post yours.
        </p>
      ) : null}
    </OverviewCard>
  );
}
