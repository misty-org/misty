import { WelcomeNav } from "./WelcomeNav";
import type { ReactNode } from "react";
import { PageEnter, Text } from "@/shared/ui";

/** A signed-out page: the floating nav, then the page's heading and its card in one centered
 * column. The signed-out window grows to fit the column (`data-signed-out-page` and
 * `data-signed-out-content`, useSignedOutWindow); it scrolls only past the screen's height. */
export default function AuthShell({ title, description, children }: AuthShellProps) {
  return (
    <div
      data-signed-out-page
      className="relative flex h-full flex-col overflow-y-auto bg-window-chrome px-4 pb-6 pt-20 sm:px-6"
    >
      <WelcomeNav />
      <div data-signed-out-content className="mx-auto my-auto w-full max-w-90">
        <PageEnter key={title} className="flex flex-col gap-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <Text as="h1" wrap size="display" weight="medium" tone="bright" className="m-0">
              {title}
            </Text>
            {description ? (
              <Text wrap size="body" tone="muted" className="m-0">
                {description}
              </Text>
            ) : null}
          </div>
          {children}
        </PageEnter>
      </div>
    </div>
  );
}

interface AuthShellProps {
  title: string;
  description?: string;
  children: ReactNode;
}
