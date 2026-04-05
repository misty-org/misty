# Embedded storage dependency license audit

Audit date: 2026-07-11

Command, run against the patched staging tree:

```sh
go run github.com/google/go-licenses@v1.6.0 report ./librclone
```

The compiled Core 3 build reported only MIT, Apache-2.0, BSD-2-Clause,
BSD-3-Clause, or CC0-1.0 licenses. No GPL, AGPL, LGPL, SSPL, or other
reciprocal dependency was reported in the compiled package graph.

Run this audit whenever the pinned upstream release or compiled backend set
changes. This report is an engineering inventory, not legal advice.
