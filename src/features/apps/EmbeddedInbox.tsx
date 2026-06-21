import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import { ProviderBrandIcon } from "../../../../misty-apps/apps/shared/ProviderBrandIcon";
import { providers, type ProviderId } from "../../../../misty-apps/apps/shared/providers";
import "../../../../misty-apps/apps/shared/providers.css";

/** Platforms without embedded websites open the same providers externally. */
export default function EmbeddedInbox() {
  const [error, setError] = useState("");
  return (
    <section className="provider-workspace provider-directory">
      <header>
        <h1>Inbox</h1>
        <p>
          Open your email provider in your browser. Embedded websites are available in Misty for
          Mac.
        </p>
      </header>
      {error && <p role="alert">{error}</p>}
      <div className="provider-integration-list" aria-label="Email providers">
        {(Object.keys(providers) as ProviderId[])
          .filter((id) => providers[id].family === "inbox")
          .map((id) => (
            <div key={id} className="provider-integration-row">
              <div className="provider-integration-icon">
                <ProviderBrandIcon provider={id} />
              </div>
              <div className="provider-integration-copy">
                <h2>{providers[id].label}</h2>
              </div>
              <button
                aria-label={`Open ${providers[id].label} in browser`}
                onClick={() => {
                  setError("");
                  void openExternalLink(providers[id].url).catch(() =>
                    setError("The website could not be opened. Try again."),
                  );
                }}
              >
                Open <ExternalLink size={15} aria-hidden />
              </button>
            </div>
          ))}
      </div>
    </section>
  );
}
