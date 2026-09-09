# Library

`index.tsx` is this app's SDK component entry. The adjacent folders own its collections and shared resources, including their colocated tests.

From the misty-apps repository, run:

```sh
npm run build:apps -- library
```

The host's shared build tooling writes `.build/official-apps/library/desktop/app.js` and `app.css`. Reload dev desktop to load the rebuilt component directly.

Shared UI, API adapters, and native infrastructure remain in the adjacent Misty host. Build aliases preserve those imports and use the host's dependency versions. This source checkout is not yet a standalone SDK-only package.
