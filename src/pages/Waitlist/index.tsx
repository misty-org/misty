import { useState, type FormEvent, type ChangeEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { submitWaitlist } from "./api";
import type { WaitlistFormProps, WaitlistFormState } from "./types";

export default function Waitlist() {
  return (
    <div
      aria-labelledby="waitlist-title"
      className="bg-background px-4 pb-20 pt-28 text-foreground sm:px-6 sm:pt-32"
    >
      <div className="mx-auto grid w-full max-w-5xl gap-10 lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-start lg:gap-16">
        <section className="pt-1" aria-label="Beta access details">
          <Badge variant="secondary" className="mb-5">
            Private beta
          </Badge>
          <h1
            id="waitlist-title"
            className="max-w-2xl text-4xl font-semibold tracking-[-0.04em] text-foreground sm:text-5xl"
          >
            Request beta access
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground sm:text-lg">
            Access opens in small cohorts. We&rsquo;ll send setup details if you&rsquo;re invited.
          </p>
        </section>

        <WaitlistForm />
      </div>
    </div>
  );
}

function WaitlistForm({ onSuccess, className }: WaitlistFormProps) {
  const [formData, setFormData] = useState<WaitlistFormState>({ email: "", name: "" });
  const [loading, setLoading] = useState<boolean>(false);
  const [success, setSuccess] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await submitWaitlist(formData);
      setSuccess(true);
      setFormData({ email: "", name: "" });
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join waitlist. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <Card className={cn("gap-0 rounded-2xl py-0", className)}>
        <CardContent
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="p-6 text-center sm:p-8"
        >
          <h2 className="mb-2 text-xl font-semibold text-card-foreground">Request received</h2>
          <p className="leading-6 text-muted-foreground">
            Check your inbox for confirmation. We&apos;ll follow up by email if your request is
            approved for an upcoming beta cohort.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("gap-0 rounded-2xl py-0", className)}>
      <CardContent className="p-6 sm:p-8">
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Access request
          </p>
          <h2 className="mt-2 text-xl font-semibold text-card-foreground">
            Your details
          </h2>
        </div>

        <form onSubmit={handleSubmit} aria-busy={loading} className="flex flex-col gap-5">
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="you@example.com"
              autoComplete="email"
              required
              className="h-11"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="name">
              Name <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="name"
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              placeholder="Your name"
              autoComplete="name"
              className="h-11"
            />
          </div>

          {error ? (
            <Alert
              variant="destructive"
              role="alert"
              aria-live="assertive"
              aria-atomic="true"
              className="border-destructive/30 bg-destructive/10"
            >
              <AlertDescription className="text-destructive">{error}</AlertDescription>
            </Alert>
          ) : null}

          <Button type="submit" size="lg" disabled={loading} className="h-11 w-full">
            {loading ? <Spinner aria-hidden="true" /> : null}
            {loading ? "Sending request..." : "Request access"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
