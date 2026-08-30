import { NavLink } from "react-router";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { marketingCopy } from "@/content/marketingCopy";

export default function Waitlist() {
  return (
    <div
      aria-labelledby="waitlist-title"
      className="bg-background pb-20 pt-28 text-foreground sm:pt-32"
    >
      <div className="site-container grid gap-10 lg:grid-cols-[minmax(0,1fr)_28rem] lg:items-start lg:gap-20">
        <section className="pt-1" aria-label="Join Misty">
          <p className="mb-5 text-sm text-muted-foreground">Misty account</p>
          <h1
            id="waitlist-title"
            className="max-w-2xl text-4xl font-semibold tracking-[-0.04em] text-foreground sm:text-5xl"
          >
            {marketingCopy.waitlist.title}
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground sm:text-lg">
            {marketingCopy.waitlist.description}
          </p>
        </section>

        <Card className="gap-0 rounded-xl py-0 shadow-xl ring-1 ring-foreground/10">
          <CardContent className="p-6 sm:p-8">
            <p className="text-sm text-muted-foreground">Ready to continue?</p>
            <h2 className="mt-2 text-xl font-semibold text-card-foreground">
              Sign in to Misty
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Use your Misty account to join a shared Space and start working
              with your group.
            </p>
            <Button asChild size="lg" className="mt-6 h-11 w-full">
              <NavLink to="/register">Join now</NavLink>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
