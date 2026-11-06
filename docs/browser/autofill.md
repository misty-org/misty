# Addresses and cards

Misty saves addresses and payment cards and fills them into forms. Sign-ins are a separate feature
with their own save offer and menu (`host_messages/passwords.rs`).

## How it works for a person

1. They click into an address or card form. An empty chip under the field reads **Fill address** or
   **Fill card**. It appears only if something of that kind is saved.
2. Clicking it opens a menu in Misty's own interface, listing what's saved, with **Manage autofill**
   last.
3. Picking an address fills the form. Picking a card asks for Touch ID, Windows Hello or the
   computer's password first, then fills the form. The security code stays for the person to type.
4. Submitting a form with something new shows **Save address?**, **Save card?** or **Save address and
   card?**. Details that differ on something already saved say **Update** instead.

Settings › Passwords has Autofill (Fill addresses, Fill cards, Offer to save) and the Addresses and
Cards lists, to add, change and delete. The switches belong to the computer and never sync, in the
`autofill` settings section. Turning a kind off stops offering, filling and saving it.

## What protects the person

- **A site learns nothing until a pick.** Anything the page script draws is within the site's reach,
  because a page can replace `document.createElement` or a property setter. So the page script never
  gets saved details to draw: not a name, not the last four digits. The list goes only to Misty's
  renderer (`AutofillChooser`). The one thing a site could infer is that something of that kind is
  saved, once someone focuses a field in its form.
- **Only what's on the page is filled or read.** Fields that are hidden, transparent, tiny, off the
  page, disabled or read-only are skipped (`onPage` in `scripts/autofill.js`), so a site can't collect
  more than the person sees. A native select may be transparent, because styled dropdowns lay one over
  their own.
- **Fills stay in their lane.** Each field type fills once, in the section the person is in, so a
  form with shipping and billing addresses fills only the one they clicked. Address fills never touch
  card fields, or the reverse. Nothing already typed is overwritten, except in the chosen field.
- **Security codes are never read, saved or filled.** The field classifier has no type for one, and
  `Card` refuses unknown fields, so a record with a code can't validate.
- **Cards only on https,** for filling and saving. Addresses work on any http(s) page.
- **The chooser fills only the page that asked,** and only while that page is on the same origin,
  checked before and after the prompt. A chooser expires in 2 minutes, a save offer in 10.
- **A card number never comes back out of native code.** Settings and the chooser get the brand, last
  four digits, name and expiry. Editing a card can replace the number but never show it.
- **Agents can't reach any of it.** Tabs an agent is working in get no chip, no chooser and no
  capture (`page_excluded`), and fields holding these details are already kept from what agents and
  page state read (`page_state/classify.rs`). Private tabs are excluded as well.
- **There's no switch for the card prompt.** A computer that can't ask (no password or Windows Hello
  set up, or Linux) doesn't fill saved cards.

## Storage

Addresses (`Kind::Address`) and cards (`Kind::Card`) live in the profile's `autofill` collection, in
its encrypted records. They're sealed with the vault key, sync across the profile's computers like
passwords, and the server holds only ciphertext. Without an account they stay on the computer in
the same encrypted store. The renderer can't reach the collection through `profile_records_*`; it
goes through the `browser_autofill_*` commands, which incognito windows are refused.

## Known limits

- **Card fields inside another site's frame aren't filled or saved.** Many checkouts put the number in
  a payment provider's iframe, such as Stripe Elements. The page script runs in the top document only,
  and messages from frames are dropped, because a frame can't be trusted with the tab's token. On those
  pages only the address half works.
- Same-origin iframes aren't covered either.
- Fields are recognized from `autocomplete` first, then names, labels and placeholders, in English.
- Saving watches form submits, submit buttons and Enter. A checkout driven by a plain button with
  its own script won't offer to save.
- State names match by abbreviation only for the US, and countries through a short list of common
  names (`autofill_fields.js`). Anything else has to match the option's text.

## Code

| Part | Where |
| --- | --- |
| Field recognition, fill plan, value formats | `src-tauri/src/infra/browser/scripts/autofill_fields.js` |
| Chip, filling and capture in the page | `src-tauri/src/infra/browser/scripts/autofill.js` |
| Page messages, offers and fills | `src-tauri/src/infra/browser/host_messages/autofill.rs` |
| What a submitted form means | `host_messages/autofill/form.rs` |
| Commands for the app and Settings | `host_messages/autofill/manage.rs` |
| Touch ID and Windows Hello | `src-tauri/src/infra/local_auth.rs`, `native/macos/MistyLocalAuth.m` |
| Record types and validation | `crates/browser-sync/src/document/entities/autofill.rs` |
| Chooser, save offer, editors | `src/features/autofill/`, `browser/workspace/AutofillOfferNotice.tsx` |
| Settings | `src/features/settings/sections/AutofillSettings.tsx` |
