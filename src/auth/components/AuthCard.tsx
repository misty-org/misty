import type { ReactNode } from "react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

interface AuthCardProps {
  title?: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export default function AuthCard({ title, description, children, footer }: AuthCardProps) {
  return (
    <Card className="bg-card p-0 shadow-xl sm:rounded-xl">
      {title || description ? (
        <CardHeader className="p-6 pb-0 sm:p-8 sm:pb-0">
          {title ? <CardTitle className="text-2xl">{title}</CardTitle> : null}
          {description ? (
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
          ) : null}
        </CardHeader>
      ) : null}

      <CardContent className="p-6 sm:p-8">{children}</CardContent>

      {footer ? <CardFooter className="border-t border-border p-6 sm:p-8">{footer}</CardFooter> : null}
    </Card>
  );
}
