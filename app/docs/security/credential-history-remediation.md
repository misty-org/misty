# Credential history remediation

The current release source is protected by a pinned Gitleaks scan in both
repositories. Local `.env` files are ignored, and `.env.desktop` is no longer
tracked. Secret values must be supplied only through the deployment or CI
secret store.

## Historical audit result

The 2026-07-28 full-history scan found previously committed server `.env`
values for:

- Stripe secret and webhook signing keys
- Mailjet secret key
- Google and Gemini API keys

Treat every historical value as compromised even if the repository has always
been private. The desktop history also contains a PostHog project token, which
is client-visible by design, plus credentials and test keys from the vendored
rclone distribution. Misty no longer uses that rclone provider path.

## Required owner actions

1. Rotate or revoke every listed server credential in its provider console.
2. Update only the deployment secret store with the replacement values.
3. Confirm Stripe webhook delivery, Mailjet send, and enabled AI provider calls
   with the replacements.
4. Decide whether to rewrite both remotes' Git history. If rewriting, coordinate
   a freeze, archive the current refs, use a reviewed `git-filter-repo` mapping,
   force-push all branches/tags, invalidate old clones and CI caches, then have
   every contributor re-clone.
5. Run a new full-history Gitleaks scan and retain only the redacted summary in
   the private security record.

History rewriting does not make an exposed credential safe and never replaces
rotation. Do not paste either old or new values into an issue, commit, log, or
support bundle.
