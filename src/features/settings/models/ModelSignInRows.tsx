import { Button, ErrorNotification, Skeleton, Spinner } from "@/shared/ui";
import { DesktopSettingsRow as Row } from "../components/DesktopSettingsUI";
import type { AddedKey, useChatgptAccount } from "./modelAccounts";
import type { SavedModelKeys } from "./modelKeys";

function chatgptDescription(account: ReturnType<typeof useChatgptAccount>): string {
  const status = account.status;
  if (!status?.signedIn)
    return "Agents use your ChatGPT plan instead of a key. It has no embedding or voice models.";
  if (!status.planUsage)
    return `Signed in as ${status.email}, but ChatGPT plan usage wasn't allowed. Sign in again and allow it, or use a key.`;
  return `Signed in as ${status.email}. Choose a chatgpt/ model below.`;
}

/** Sign in with ChatGPT and OpenRouter's sign-in, the two ways to skip copying a key. */
export function ModelSignInRows(props: {
  keys: SavedModelKeys;
  chatgpt: ReturnType<typeof useChatgptAccount>;
  onSignedIn: (provider: string, added?: AddedKey) => void;
}) {
  const chatgpt = props.chatgpt;
  const openRouterSaved = props.keys.saved?.includes("openrouter") ?? false;
  return (
    <>
      <Row label="ChatGPT" description={chatgptDescription(chatgpt)}>
        <div className="flex w-[240px] max-w-full justify-end gap-2">
          {chatgpt.status === null ? (
            <Skeleton aria-label="ChatGPT sign-in status" className="h-8 w-24 rounded-md" />
          ) : chatgpt.status.signedIn && chatgpt.status.planUsage ? (
            <Button
              variant="outline"
              size="sm"
              disabled={chatgpt.busy}
              onClick={() => void chatgpt.signOut()}
            >
              Sign out
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={chatgpt.busy}
              aria-busy={chatgpt.busy}
              onClick={() =>
                void chatgpt.signIn().then((next) => next?.planUsage && props.onSignedIn("chatgpt"))
              }
            >
              {chatgpt.busy ? <Spinner size="sm" label={false} /> : null}
              {chatgpt.status.signedIn ? "Sign in again" : "Sign in"}
            </Button>
          )}
        </div>
      </Row>
      <ErrorNotification message={chatgpt.error} />
      <Row
        label="OpenRouter"
        description={
          openRouterSaved
            ? "OpenRouter's key is saved. Replace or remove it under Provider."
            : "Sign in to OpenRouter and it makes a key for Misty, saved on this computer."
        }
      >
        <div className="flex w-[240px] max-w-full justify-end">
          <Button
            variant="outline"
            size="sm"
            disabled={props.keys.saved === null}
            onClick={() =>
              void props.keys
                .signInToOpenRouter()
                .then((added) => added && props.onSignedIn("openrouter", added))
            }
          >
            {openRouterSaved ? "Sign in again" : "Sign in"}
          </Button>
        </div>
      </Row>
    </>
  );
}
