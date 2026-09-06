import { LoaderCircle, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { useAuth } from "@/features/auth";
import { spaceNotesEnabled } from "@/features/notes/availability";
import { spacesApi } from "@/api/spaces/api";
import type { SpaceInvitationPreview } from "@/api/spaces/dto/interfaces/types";
import { Button, Card } from "@/shared/ui";
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
  const returnPath = `/invite/${encodeURIComponent(token)}`;

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

  const join = async () => {
    if (!user || joining) return;
    setJoining(true);
    setError("");
    try {
      const space = await spacesApi.redeemInvitation(token);
      await loadSpaces();
      navigate(
        `/spaces/${encodeURIComponent(space.id)}/${spaceNotesEnabled ? "notes" : "drawings"}`,
        { replace: true },
      );
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
          <LoaderCircle className="mx-auto size-6 animate-spin text-cream-muted" />
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
                  {joining ? <LoaderCircle className="size-4 animate-spin" /> : null}
                  {joining ? "Joining…" : "Join Space"}
                </Button>
                <p className="m-0 text-xs text-cream-muted">Signed in as {user.email}</p>
              </div>
            ) : (
              <div className="mt-5 grid grid-cols-2 gap-2">
                <Button asChild>
                  <Link to="/signin" state={{ from: returnPath }}>
                    Sign in
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to="/register" state={{ from: returnPath }}>
                    Create account
                  </Link>
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
