import { Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { openSignInSheet, useAuth } from "@/features/auth";
import { spacesApi } from "@/api/spaces/api";
import type { SpaceInvitationPreview } from "@/api/spaces/dto/entities";
import { Button, Card, Spinner } from "@/shared/ui";
import { useSpacesStore } from "../store/useSpacesStore";

export function SpaceInvitationRedemption() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const loadSpaces = useSpacesStore((state) => state.load);
  const [preview, setPreview] = useState<SpaceInvitationPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void spacesApi
      .invitationPreview(token)
      .then((result) => {
        if (active) setPreview(result);
      })
      .catch(() => {
        if (active) setError("This invitation is invalid or no longer available.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  // An invite link is one of the few things that asks for an account: the sign-in sheet
  // opens over the window, and the invitation waits here to be accepted after.
  useEffect(() => {
    if (!user) openSignInSheet("invite");
  }, [user, token]);

  const join = async () => {
    if (!user || joining) return;
    setJoining(true);
    setError("");
    try {
      const space = await spacesApi.redeemInvitation(token);
      await loadSpaces();
      navigate(`/spaces/${encodeURIComponent(space.id)}/notes`, { replace: true });
    } catch {
      setError(
        "Misty could not accept this invitation. Make sure you are signed in with the invited email.",
      );
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="grid h-full place-items-center bg-charcoal-bg p-6">
      <Card className="w-full max-w-md p-6 text-center">
        {loading ? (
          <Spinner size="lg" label={false} className="size-6 mx-auto text-cream-muted" />
        ) : preview ? (
          <>
            <span className="mx-auto grid size-11 place-items-center rounded-xl bg-charcoal-active text-cream-bright">
              <Users size={20} />
            </span>
            <h1 className="mb-0 mt-4 text-xl font-semibold">Join {preview.space_name}</h1>
            <p className="mb-0 mt-2 text-sm text-cream-muted">
              {preview.inviter_name} invited {preview.invited_email} to collaborate in this Space.
            </p>
            {user ? (
              <div className="mt-5 grid gap-2">
                <Button type="button" disabled={joining} onClick={() => void join()}>
                  {joining ? <Spinner label={false} /> : null}
                  {joining ? "Joining…" : "Join Space"}
                </Button>
                <p className="m-0 text-xs text-cream-muted">Signed in as {user.email}</p>
              </div>
            ) : (
              <div className="mt-5 grid gap-2">
                <Button type="button" onClick={() => openSignInSheet("invite")}>
                  Sign in to join
                </Button>
              </div>
            )}
          </>
        ) : null}
        {error ? (
          <p className="mb-0 mt-4 rounded-lg bg-charcoal-active p-3 text-sm text-cream-bright">
            {error}
          </p>
        ) : null}
      </Card>
    </div>
  );
}
