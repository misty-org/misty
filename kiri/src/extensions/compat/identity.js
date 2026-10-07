// SPDX-License-Identifier: MIT
// Misty rewrites an extension's OAuth redirect to this page; the address that
// the provider redirected to is carried in the fragment.
"use strict";
new BroadcastChannel("misty-compat").postMessage({
  identity: decodeURIComponent(location.hash.slice(1)),
});
