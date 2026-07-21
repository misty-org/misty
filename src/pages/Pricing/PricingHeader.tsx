import { Badge } from "@/components/ui/badge";

export default function PricingHeader() {
  return (
    <header className="mx-auto mb-12 max-w-3xl text-center md:mb-14">
      <div className="mb-5 flex flex-wrap items-center justify-center gap-2">
        <Badge variant="outline">Invite-only beta</Badge>
        <Badge variant="secondary">Future pricing</Badge>
      </div>
      <h1 className="mb-5 text-balance text-3xl font-bold tracking-tight text-foreground md:text-5xl">
        Future plans and limits
      </h1>
      <p className="mx-auto max-w-2xl text-balance text-sm leading-6 text-muted-foreground md:text-base">
        Free, Pro, and Max set limits for owned Spaces, members, Library storage, and Mika.
      </p>
    </header>
  );
}
