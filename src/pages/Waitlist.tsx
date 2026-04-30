import { useState, FormEvent, ChangeEvent } from 'react';

const apiBase = (import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "");


export default function Waitlist() {
    return (
        <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 sm:px-5">
            <div className="w-full max-w-md">
                <div className="text-center mb-8">
                    <h1 className="text-3xl md:text-4xl font-bold text-text mb-2">
                        Join the Waitlist
                    </h1>
                    <p className="text-text-muted">
                        Be the first to know when we launch.
                    </p>
                </div>

                <WaitlistForm />
            </div>
        </div>
    )
}

interface WaitlistFormState {
  email: string;
  name: string;
}

interface WaitlistFormProps {
  onSuccess?: () => void;
  className?: string;
}

function WaitlistForm({ onSuccess, className }: WaitlistFormProps) {
  const [formData, setFormData] = useState<WaitlistFormState>({ email: '', name: '' });
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
      const response = await fetch(`${apiBase}/waitlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        setSuccess(true);
        setFormData({ email: '', name: '' });
        onSuccess?.();
      } else {
        const text = await response.text();
        throw new Error(text || 'Submission failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join waitlist. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="glass-card rounded-2xl p-6 sm:p-8 text-center">
        <h3 className="text-xl font-bold text-text mb-2">You're on the list!</h3>
        <p className="text-text-muted">Check your email for confirmation.</p>
      </div>
    );
  }

  return (
    <div className={`glass-card rounded-2xl p-6 sm:p-8 ${className ?? ''}`}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <label htmlFor="email" className="text-sm font-medium text-text-secondary">
            Email
          </label>
          <input
            id="email"
            type="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            placeholder="you@example.com"
            required
            className="w-full px-4 py-2.5 rounded-xl bg-surface border border-border text-base text-text placeholder:text-text-muted/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="name" className="text-sm font-medium text-text-secondary">
            Name <span className="text-text-muted">(optional)</span>
          </label>
          <input
            id="name"
            type="text"
            name="name"
            value={formData.name}
            onChange={handleChange}
            placeholder="Your name"
            className="w-full px-4 py-2.5 rounded-xl bg-surface border border-border text-base text-text placeholder:text-text-muted/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
          />
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full px-4 py-2.5 bg-zinc-100 hover:bg-gray-200 disabled:opacity-50 text-black font-medium rounded-xl transition-all duration-200"
        >
          {loading ? 'Joining...' : 'Join Waitlist'}
        </button>
      </form>
    </div>
  );
}
