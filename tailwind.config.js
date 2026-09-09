import { appSourceRoot } from "./scripts/app-source-paths.mjs";
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    `${appSourceRoot(process.cwd())}/apps/**/*.{ts,tsx}`,
  ],
  theme: {
    extend: {
      zIndex: {
        "photo-editor-ai": "2147483350",
      },
    },
  },
  plugins: [],
};
