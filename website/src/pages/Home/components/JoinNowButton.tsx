import { NavLink } from "react-router";

import { Button } from "@/components/ui/button";
import { JOIN_HREF } from "@/lib/site";

export function JoinNowButton({ inverted = false }: { inverted?: boolean }) {
  return (
    <Button
      asChild
      size="lg"
      className={
        inverted
          ? "bg-background px-5 text-foreground hover:bg-background/85"
          : "px-5"
      }
    >
      <NavLink to={JOIN_HREF}>Join now</NavLink>
    </Button>
  );
}
