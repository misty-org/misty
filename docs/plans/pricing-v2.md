# Pricing v2: four plans, cost-bounded AI

Agreed 2026-10-09. Phases 1–5 implemented 2026-10-09 (uncommitted); Stripe test
mode configured; phase 6 (production) and live Stripe remain.

## As built

- Models: Fast `openai/gpt-6-luna` ($0.10/$0.50 per M), paid default Mid
  `openai/gpt-6.1-sol` ($2/$10), flagship `openai/gpt-6-astra` ($10/$50; billing
  previously charged it at a $5/$30 guess). Override with `MISTY_AI_FAST_MODEL`
  and `MISTY_AI_PAID_DEFAULT_MODEL`.
- The monthly ceiling is a rolling 31 days (bounds any calendar or billing month),
  not the subscription period.
- Background jobs and scheduled workflows: per-task cap 10% (2% refused a Pro
  scheduled workflow after one or two Mid steps).
- Ultra perks: more model turns per ordinary request (Max 30, Ultra 60, Ultra+
  90; Basic and Pro 20). Run time and concurrency limits live in the runtime and
  are unchanged.
- Voice: Realtime costs ~110–140k weighted tokens per spoken reply (audio is $32
  in / $64 out per million tokens). Basic uses the voice pipeline instead
  (`misty/voice-pipeline`): ElevenLabs Scribe v2 Realtime listening ($0.39/hour,
  a Go socket like Realtime's), the fast model, then ElevenLabs Flash v2.5
  speech ($0.04 per 1,000 characters, through the runtime's AI SDK,
  `@ai-sdk/elevenlabs` 3.0.30), about 15k per reply (admission bound ~25k;
  replies capped at 300 tokens and 600 characters). Every plan uses the pipeline;
  `MISTY_VOICE_PIPELINE=realtime` opts a server back into Realtime.
  Both use the same voice style prompt (a warm, patient teacher; brief; replies
  in the user's language). The pipeline emits Realtime's event protocol, so the
  session, tools and billing flow are shared. Env (in `integrations/ai.env`):
  `ELEVENLABS_API_KEY` (Misty's own; read by the API and the agent runtime),
  `MISTY_VOICE_ID` (ElevenLabs voice ID; empty uses ElevenLabs' default),
  `MISTY_VOICE_TTS_MODEL` (default `elevenlabs/eleven_flash_v2_5`),
  billing
  `MISTY_VOICE_STT_HOUR_MICROUSD` (390,000), `MISTY_VOICE_TTS_CHAR_MICROUSD` (40),
  `MISTY_VOICE_PIPELINE_TEXT_MODEL` (must match `MISTY_AI_FAST_MODEL`). Without an
  ElevenLabs key every plan falls back to Realtime. Billing v0.1.0 predates pipeline
  pricing: release billing again before deploying a server with it.
- Capacity (2026-10-10): the agent runtime's own rate limits count only failed
  requests (`skipSuccessfulRequests`), because every legitimate call comes from
  the API's single address; users are rate limited by the API. Workflow steps
  run 50 at once (`WORKFLOW_POSTGRES_WORKER_CONCURRENCY`, default was 10) on a
  60-connection pool (`WORKFLOW_POSTGRES_MAX_POOL_SIZE`); Postgres allows 200
  connections (`POSTGRES_MAX_CONNECTIONS`). ElevenLabs plans cap concurrent
  requests; check the plan before launch.
- Server ↔ billing contract: `server/scripts/test-billing-contract.sh` covers
  limit refusals, the grace, web search, unpriced models, referrals and the
  summary against the real billing binary.
 Replaces the `account-v1` billing policy (Basic 10M / Pro 30M /
Max 60M weekly), which could cost far more than the $8 and $19 prices.

## Rules

- A paid plan's worst-case month (full AI ceiling plus full storage) costs less
  than its net revenue. Net uses the yearly price (two months free) after Stripe's
  2.9% + $0.30. Storage costs R2's $0.015 per GB-month.
- Every plan gives more per dollar than the plan below it, and Ultra beats five Max
  accounts on every meter, so stacking cheaper accounts never pays.
- Every feature is on every plan. Plans differ only in AI amount, models and
  storage. No trials: the free tier is the trial.
- Sync is unlimited on every plan (decided 2026-10-11). Sync bytes are never metered
  against a plan or shown as an allowance; abuse is handled by rate limits, not a quota.
- No BYOK: every model runs on Misty's keys (reconfirmed 2026-10-11).
- Usage is measured in weighted tokens: 1 = $0.000001 of provider cost. Users see
  "% of this week's AI used", never a token count.

## Plans

| | Basic | Pro | Max | Ultra | Ultra+ |
| --- | ---: | ---: | ---: | ---: | ---: |
| Monthly | Free | $12 | $20 | $100 | $200 |
| Yearly | Free | $120 | $200 | $1,000 | $2,000 |
| Net per month (yearly) | – | $9.69 | $16.16 | $80.89 | $161.81 |
| 5-hour AI limit | 135k | 480k | 825k | 4.3M | 8.7M |
| Weekly AI limit | 450k | 1.6M | 2.75M | 14.25M | 29M |
| Monthly AI ceiling | 2M | 7M | 12M | 62M | 126M |
| Monthly AI per $1 | – | 0.58M | 0.60M | 0.62M | 0.63M |
| Storage | 5 GB | 50 GB | 200 GB | 1 TB | 2 TB |
| Models | Fast | Fast, Mid, Flagship | same | same | same |
| Default model | Fast | Mid | Mid | Mid | Mid |
| Worst-case month | $2.08 | $7.75 | $15.00 | $77.00 | $156.00 |

Three limits apply at once, and work is admitted only when it fits all three:

- **5-hour limit**, 30% of the weekly limit. The window opens at the first
  admitted AI work and lasts five hours; the next work after it closes opens a new
  one. It paces heavy sessions and lets an exhausted free user come back the same
  day.
- **Weekly limit**, refilled at the weekly reset (the existing wallet).
- **Monthly ceiling**, the cost guarantee. The weekly limit is the monthly ceiling
  ÷ 4.35, so a steady user never reaches it; it only stops use timed around reset
  boundaries.

**Finishing over the limit.** A task that started inside its limits may finish
even if it crosses one, by up to 20% of the 5-hour limit (the grace). The first
step past a limit tells the model to wrap up in as few steps as it can, or report
where it stopped. A task that would pass its grace stops at the next step and
reports its progress. The grace applies to all three limits, at most once per
window, so the worst case becomes the monthly ceiling plus one grace: $2.10,
$7.85, $15.17, $77.86 and $157.74, all still under net. The per-task cap stays hard; it is
the runaway guard.

**Goals stop at a phase boundary.** Each goal continuation is a new run. Once any
limit is reached, no new continuation starts: the goal shows "Paused until 4:10
PM" (the reset time) and resumes by itself then. The phase already running
finishes under the same grace as any task.

Background jobs (library indexing, scheduled workflows) count toward the weekly
limit and monthly ceiling but not the 5-hour window, so an upload never blocks
chat.

Per-task cap: 25% of the weekly limit for foreground work (was 10%), 2% for
background jobs. It always fits inside one 5-hour window. At flagship rates that
is about 7 steps per task on Pro, 12 on Max and 60 on Ultra.

The app shows the tightest limit first: "% of this session used, resets in 2h 10m",
with the weekly figure beneath it.

Ultra+ beats two Ultra accounts on every meter. Ultra and Ultra+ perks that cost
nothing beyond their ceilings: more concurrent runs, a longer
run time limit and more scheduled workflows. The exact values are set in phase 2
once the current limits are located.

The worst case holds only after the leak fixes in phase 1 and phase 2 land.

## Phase 1: billing service (`misty-billing`)

1. **5-hour window and monthly ceiling.** Migration 019 adds to
   `billing.usage_wallets` a window start and window consumed counter, and a
   period start and period consumed counter. Reservations count toward the
   window and period they were admitted in; a release returns them there.
   Admission refuses work that does not fit the 5-hour window (foreground only),
   the weekly wallet or the plan's `ai_monthly_units` over any 31 days, and the
   refusal says which limit and when it resets.
   A command first admitted inside all limits may keep reserving past them until
   its overrun reaches the grace (`grace_bps` 2000 of the 5-hour limit); the
   decision carries `over_limit` so the runtime can tell the model to wrap up. A
   new command is refused once a limit is reached.
2. **Policy shape.** `internal/policy/account.go` and `allowance.go`: add the
   `ultra` and `ultra_plus` plans, `ai_monthly_units` and `window_bps` (3000). Raise the policy validation if needed so
   `command_bps` 2500 is accepted (the cap is 25%, so it should already pass).
3. **Tier order.** Rank `ultra_plus` above `ultra` above `max` everywhere a tier is chosen:
   `internal/payments/events.go:139`, `internal/payments/refunds.go:67` and `:80`,
   `internal/store/customer_summary.go`.
4. **Stripe prices.** `internal/payments/stripe.go:43`: add `ultra` and
   `ultra_plus` monthly and yearly from `STRIPE_PRICE_ULTRA_{MONTHLY,YEARLY}` and
   `STRIPE_PRICE_ULTRA_PLUS_{MONTHLY,YEARLY}`.
5. **No trials.** Remove the 14-day trial in `internal/payments/service.go:232-245`
   and report `trial_eligible: false` until clients stop reading it.
6. **Web search.** New `web.search` operation priced per request for each engine
   (Parallel, Perplexity, Exa), with rates from the Gateway pricing page and env
   overrides, plus the small model call that issues the search.
7. **Real model prices.** Price every model a user can pick from the Gateway's
   public catalog pricing, cached. Refuse admission for a model with no known price
   instead of using the $5/$30 fallback.
8. **Global circuit breaker.** A deployment-wide daily weighted-token ceiling
   across all accounts (`MISTY_BILLING_GLOBAL_DAILY_UNITS`). The agent runtime's
   model calls bypass the server's `MISTY_AI_MAX_*` ceiling today; billing sees
   every reservation, so the ceiling belongs here.
9. **Outbox poison.** The server outbox retries permanent failures (invalid,
   conflict) every minute forever; dead-letter them for operator review.
10. **Publish `account-v2`** with the numbers above and update
    `config/account-policy.example.json` and the README tables.

## Phase 2: server (`misty`)

1. **Web search billing.** `server/internal/platform/httpapi/web_search.go`
   reserves `web.search` with the engine and request count.
2. **Models by plan.** Basic accounts route Thinking and Seeing to the fast model
   and their picker shows only it. Paid pickers list only priced models; Mid is
   the default. Files: `internal/platform/httpapi/ai_model_senses.go`,
   `internal/agents/model_catalog_senses.go`, `runtimeModelBilling`.
3. **Email verification.** Password signups verify their email before AI is
   admitted (Google sign-in is already verified). Signups stay rate limited.
4. **Released failed calls.** Web search, refine-point and conversation summary
   release the hold when the call fails or times out, even if the provider already
   charged. Settle measured usage when it exists and keep the hold for
   reconciliation when it does not.
5. **Under-reserved input.** Bytes ÷ 4 underestimates CJK text and anything above
   the hold is never charged. Measure tokens or use a safer ratio.
6. **Wrap-up and paused goals.** On `over_limit` the agent runtime adds a
   wrap-up instruction before the next step; past the grace it ends the run as
   incomplete with its progress, not as failed. A goal continuation refused for a
   limit pauses the goal with the reset time and the delivery worker queues it for
   that time (`ai_collaboration.go`, goal continuations).
7. **Ultra perks.** Locate the run concurrency, run time and schedule limits and
   make them plan-aware.
8. **Usage display.** The app shows "% of this week's AI used" and when it
   refills; an exhausted free allowance says when it refills before it mentions
   upgrading.

## Phase 3: website (`misty-website`)

- `src/pages/Pricing/data.ts`: four plans, prices above, storage and AI copy that
  matches billing exactly, no trial wording.
- `PlanGrid`, `PricingCard`, `renewalTerms`, `useProCheckout`, `BillingPanel`:
  drop "Start free trial", add Ultra checkout.
- Update `tests/pricing.spec.ts` and `src/test/pricing-contract.test.ts`.

## Phase 4: Stripe (test mode first, then live)

1. **Products.** Keep Misty Pro and Misty Max; add Misty Ultra and Misty Ultra+.
2. **Prices** (recurring, USD, tax behavior set once and kept the same):
   Pro $12/month and $120/year, Max $20/month and $200/year, Ultra $100/month and
   $1,000/year, Ultra+ $200/month and $2,000/year. Archive the old $8, $79, $19 and $189 prices.
3. **Customer portal.** Enable subscription updates with price changes across all
   eight prices, proration "always invoice", and cancellation at period end.
4. **Webhook** (live): `https://billing.mistysys.com/stripe/webhook` with
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.expired`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `charge.refunded`, `charge.dispute.created`.
5. **Env files** (mode 0600):
   - test: `misty-billing/.env/dev/integrations/stripe.env`
   - live: `misty-billing/.env/prod/stripe.env` (does not exist yet)
   - keys: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, the eight
     `STRIPE_PRICE_{PRO,MAX,ULTRA,ULTRA_PLUS}_{MONTHLY,YEARLY}` IDs and the three return URLs.
6. **Optional.** Stripe Tax registrations, statement descriptor, branding and
   receipt emails.

## Phase 5: referrals (after phases 1–4)

Your allowance grows with the people you bring. Each friend who subscribes adds a
fixed monthly AI bonus to your account for as long as they stay subscribed, sized
at about 10% of what their plan brings in, so every bonus is paid for by the
referral that earned it:

| Friend's plan | Your monthly AI bonus |
| --- | ---: |
| Pro | +1M |
| Max | +1.6M |
| Ultra | +8M |
| Ultra+ | +16M |

- The bonus raises your monthly ceiling by its amount and your weekly and 5-hour
  limits in proportion. It works on every plan, Basic included. Total bonus is
  capped at your plan's base allowance (at most 2× it).
- The friend gets the same bonus as the referrer for their first two months, so
  joining through a link is better than joining alone.
- A referral counts once the friend's first payment has cleared for 14 days, from a
  verified email and a card fingerprint that has never paid for the referrer. It
  ends on cancellation, refund or dispute. Free signups earn nothing, so throwaway
  accounts are worthless.
- The invite appears where it helps: in Settings, and when a user first nears a
  limit ("Invite friends to raise your limits"). No task-count trigger.
- Billing: a referrals table, bonus units added to the allowance calculation, and
  `invoice.paid` handling. Server: codes, `/r/CODE` links, signup attribution and
  abuse signals. Website: the referral landing. App: monochrome card and Settings
  section.

## Phase 6: production rollout

Production has never been released: no API or billing image, no live Stripe
configuration, billing writer never enabled.

1. Release billing (`deploy/release.sh`), start it (`deploy/prod.sh up`),
   `enable-writer`, publish `account-v2`.
2. Set the server's AI keys and security env in `server/.env/prod`, release and
   deploy the API and agent runtime.
3. In Stripe test mode, check end to end: checkout for each plan, upgrade
   Pro → Max → Ultra through the portal, cancel, refund, webhook replay, the
   monthly ceiling refusing work, and a web search charge.
4. Switch to live keys.
