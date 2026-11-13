import { Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { useAuth } from "@/features/account";
import { spacesApi } from "../api/api";
import type { SpaceInvitationPreview } from "../api/dto/entities";
import { Button, Card, PlaceholderIcon, Spinner, Surface, Text, useNotice } from "@/shared/ui";
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

  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });

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

  // Signed out, an invite link goes to sign in first and comes back here after.
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
    <Surface tone="page" className="grid h-full place-items-center p-6">
      <Card className="w-full max-w-md p-6 text-center">
        {loading ? (
          <Text bare as="div" tone="muted" className="flex justify-center">
            <Spinner size="lg" label={false} className="size-6" />
          </Text>
        ) : preview ? (
          <>
            <PlaceholderIcon icon={Users} className="mx-auto" />
            <h1 className="mb-0 mt-4 text-xl font-semibold">Join {preview.space_name}</h1>
            <Text tone="muted" wrap className="mb-0 mt-2 text-sm">
              {preview.inviter_name} invited {preview.invited_email} to collaborate in this Space.
            </Text>
            <div className="mt-5 grid gap-2">
              <Button type="button" loading={joining} onClick={() => void join()}>
                Join Space
              </Button>
              {user ? (
                <Text tone="muted" wrap className="m-0 text-xs">
                  Signed in as {user.email}
                </Text>
              ) : null}
            </div>
          </>
        ) : null}
      </Card>
    </Surface>
  );
}
