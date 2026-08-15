# Misty CLI documentation

The documentation site is a standalone Vite and React application generated
from the `misty` v0.1.0 command contract.

```bash
cd ~/misty-org/misty/cli/docs
npm ci
npm run dev
```

The development server defaults to `http://localhost:4174`. Build the static
site with:

```bash
npm run build
npm run preview
```

When the Rust command surface changes, update the relevant content module under
`src/content/` in the same commit.
