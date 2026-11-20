import { Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { useAuth } from "@/features/account";
import { spacesApi } from "../api/api";
import type { SpaceInvitationPreview } from "../api/dto/entities";
import {
  Button,
  Card,
  ErrorState,
  PlaceholderIcon,
  Skeleton,
  SkeletonControl,
  Surface,
  Text,
  useNotice,
} from "@misty/ui";
import { useSpacesStore } from "../list/useSpacesStore";

export function SpaceInvitationRedemption() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const loadSpaces = useSpacesStore((state) => state.load);
  const [preview, setPreview] = useState<SpaceInvitationPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  // The preview's read failed: the card says so in place of the invitation, with a retry.
  const [readFailed, setReadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });

  useEffect(() => {
    let active = true;
    setLoading(true);
    setReadFailed(false);
    void spacesApi
      .invitationPreview(token)
      .then((result) => {
        if (active) setPreview(result);
      })
      .catch(() => {
        if (active) setReadFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token, attempt]);

  // Signed out, an invite link goes to sign in first and comes back here after.
  const join = async () => {
    if (!user || joining) return;
    setJoining(true);
    setError("");
    try {
      const space = await spacesApi.redeemInvitation(token);
      await loadSpaces();
      navigate(`/spaces/${encodeURIComponent(space.id)}`, { replace: true });
    } catch {
      setError(
        "Misty could not accept this invitation. Make sure you are signed in with the invited email.",
      );
    } finally {
      setJoining(false);
    }
  };

  return (
    <Surface tone="page" className="grid h-full place-items-center p-6">
      <Card className="w-full max-w-md p-6 text-center">
        {loading ? (
          <InvitationSkeleton signedIn={Boolean(user)} />
        ) : preview ? (
          <>
            <PlaceholderIcon icon={Users} className="mx-auto" />
            <h1 className="mb-0 mt-4 text-xl font-semibold">Join {preview.space_name}</h1>
            <Text tone="muted" wrap className="mb-0 mt-2 text-sm">
              {preview.inviter_name} invited {preview.invited_email} to collaborate in this Space.
            </Text>
            <div className="mt-5 grid gap-2">
              <Button type="button" disabled={joining} onClick={() => void join()}>
                Join Space
              </Button>
              {user ? (
                <Text tone="muted" wrap className="m-0 text-xs">
                  Signed in as {user.email}
                </Text>
              ) : null}
            </div>
          </>
        ) : readFailed ? (
          <ErrorState
            inline
            title="This invitation isn't available"
            line="It may have expired or been withdrawn, or Misty couldn't reach the server."
            action={{
              label: "Try again",
              variant: "secondary",
              onClick: () => setAttempt((count) => count + 1),
            }}
          />
        ) : null}
      </Card>
    </Surface>
  );
}

/**
 * The invitation while it is read, shaped like it: the icon, the "Join" heading, the two lines on
 * who invited whom, the Join button and, signed in, the line under it.
 */
function InvitationSkeleton({ signedIn }: { signedIn: boolean }) {
  return (
    <div role="status" aria-label="Loading invitation" aria-busy="true">
      <Skeleton className="mx-auto size-8 rounded-lg" />
      <div className="mt-4 flex h-7 items-center justify-center">
        <Skeleton className="h-5 w-48" />
      </div>
      <div className="mt-2 grid justify-items-center">
        <div className="flex h-5 w-full items-center justify-center">
          <Skeleton className="h-3.5 w-11/12" />
        </div>
        <div className="flex h-5 w-full items-center justify-center">
          <Skeleton className="h-3.5 w-1/2" />
        </div>
      </div>
      <div className="mt-5 grid gap-2">
        <SkeletonControl kind="button" className="w-full" />
        {signedIn ? (
          <div className="flex h-4 items-center justify-center">
            <Skeleton className="h-3 w-40" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
