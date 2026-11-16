import type { ReactNode } from "react";

import { Separator, Surface, Text } from "@/shared/ui";

/** The card a signed-out page's form sits in: a raised card with a hairline edge, no shadow. */
export default function AuthCard({ title, description, children, footer }: AuthCardProps) {
  return (
    <Surface tone="card" edge="hairline" radius="xl" className="flex w-full flex-col gap-6 p-6">
      {title || description ? (
        <div className="flex flex-col gap-1">
          {title ? (
            <Text as="h2" wrap size="title" weight="semibold" tone="bright" className="m-0">
              {title}
            </Text>
          ) : null}
          {description ? (
            <Text wrap size="control" tone="muted" className="m-0">
              {description}
            </Text>
          ) : null}
        </div>
      ) : null}

      {children}

      {footer ? (
        <>
          <Separator />
          <div className="flex items-center justify-center">{footer}</div>
        </>
      ) : null}
    </Surface>
  );
}

interface AuthCardProps {
  title?: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}
