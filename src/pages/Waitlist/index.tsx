import { useState, type FormEvent, type ChangeEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
    <section
      aria-labelledby="waitlist-title"
      className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-background px-4 text-foreground sm:px-5"
    >
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 id="waitlist-title" className="mb-2 text-3xl font-bold tracking-tight md:text-4xl">
            Join the Waitlist
          </h1>
          <p className="text-muted-foreground">Be the first to know when we launch.</p>
        </div>

        <WaitlistForm />
      </div>
    </section>
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
          <h3 className="mb-2 text-xl font-bold text-card-foreground">You&apos;re on the list!</h3>
          <p className="text-muted-foreground">Check your email for confirmation.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("gap-0 rounded-2xl py-0", className)}>
      <CardContent className="p-6 sm:p-8">
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
            {loading ? "Joining..." : "Join Waitlist"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
