# Embedded storage dependency license audit

Audit date: 2026-07-11

Command:

```sh
go run github.com/google/go-licenses@v1.6.0 report ./librclone
```

The compiled Core 3 build reported only permissive or public-domain-style licenses:

- MIT
- Apache-2.0
- BSD-2-Clause
- BSD-3-Clause
- CC0-1.0

No GPL, AGPL, LGPL, SSPL, or other reciprocal dependency was reported in the compiled `./librclone` package graph. The scanner warned that assembly/C files in `cpuid`, `purego`, `x/sys`, `xxhash`, and the Prometheus client cannot be dependency-inspected as Go source; their containing modules were individually reported as MIT, Apache-2.0, BSD, or Apache-2.0 respectively.

Run this audit again whenever the pinned upstream release or compiled backend set changes. This report is an engineering inventory, not legal advice.
