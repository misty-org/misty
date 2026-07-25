import type { ReactNode } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface AuthCardProps {
  title?: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export default function AuthCard({
  title,
  description,
  children,
  footer,
}: AuthCardProps) {
  return (
    <Card className="gap-0 rounded-xl bg-card p-6 text-card-foreground shadow-xl ring-1 ring-foreground/10 sm:p-8">
      {title || description ? (
        <CardHeader className="p-0">
          {title ? (
            <CardTitle
              role="heading"
              aria-level={2}
              className="text-2xl font-semibold"
            >
              {title}
            </CardTitle>
          ) : null}
          {description ? (
            <CardDescription className="mt-2 leading-6">
              {description}
            </CardDescription>
          ) : null}
        </CardHeader>
      ) : null}

      <CardContent className={title || description ? "mt-7 p-0" : "p-0"}>
        {children}
      </CardContent>

      {footer ? (
        <CardFooter className="mt-6 justify-center border-t border-border p-0 pt-6">
          {footer}
        </CardFooter>
      ) : null}
    </Card>
  );
}
