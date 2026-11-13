import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button, Input, Text, useNotice } from "@/shared/ui";
import { useSpacesStore } from "../list/useSpacesStore";
import {
  activeClaims,
  claimBody,
  claimMaxLength,
  overlappingClaim,
  postedAgo,
} from "../handoffs/spacePosts";
import { OverviewCard } from "./OverviewCard";
import { ActivityRowsSkeleton } from "./SpaceActivityLog";
import { useNow } from "@/shared/hooks/useNow";

/**
 * What the members of a Space said they are working on, in their own words. A claim is a
 * message its person posts in the Space chat; it can be released and stops showing after a
 * day. Typing one that overlaps someone else's shows a warning and never stops the post.
 */
export function WorkingOn({ spaceId, me }: { spaceId: string; me: string }) {
  const messages = useSpacesStore((state) => state.messagesBySpace[spaceId]);
  const readOnly = useSpacesStore((state) => state.referenceOnly);
  // A chat that couldn't be read shows no claims rather than a skeleton that never ends.
  const loadFailed = useSpacesStore((state) => Boolean(state.messageErrorsBySpace[spaceId]));
  // Claims expire while the page stays open.
  const now = useNow();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const store = useSpacesStore.getState();
    if (!store.messagesBySpace[spaceId] && !store.referenceOnly) void store.loadMessages(spaceId);
  }, [spaceId]);

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
      {!messages && !readOnly && !loadFailed ? (
        <ActivityRowsSkeleton rows={1} />
      ) : (
        <ul className="m-0 grid list-none p-0">
          {claims.map((claim) => (
            <li key={claim.id} className="flex min-h-9 min-w-0 items-center gap-2 px-2.5 py-1">
              <Text full tone="muted" className="min-w-0 flex-1 text-sm">
                <Text bare tone="default">
                  {claim.userId === me ? "You" : claim.name}
                </Text>
                {" · "}
                {claim.text}
              </Text>
              <Text bare tone="muted" className="shrink-0 text-xs">
                {postedAgo(claim.createdAt, now)}
              </Text>
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
