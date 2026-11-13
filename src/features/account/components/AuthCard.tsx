import type { ReactNode } from "react";

import { Surface, Text } from "@/shared/ui";

export default function AuthCard({ title, description, children, footer }: AuthCardProps) {
  return (
    <Surface tone="card" edge="hairline" radius="xl" className="w-full p-6 shadow-xl">
      {title || description ? (
        <div className="mb-7">
          {title ? (
            <Text bare as="h2" tone="default" className="text-2xl font-semibold">
              {title}
            </Text>
          ) : null}
          {description ? (
            <Text bare as="p" tone="muted" className="mt-2 text-sm leading-6">
              {description}
            </Text>
          ) : null}
        </div>
      ) : null}

      <div>{children}</div>

      {footer ? (
        <div className="mt-6 flex items-center justify-center border-t pt-6">{footer}</div>
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
