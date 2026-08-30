/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      zIndex: {
        "photo-editor-ai": "2147483350",
      },
    },
  },
  plugins: [],
};
