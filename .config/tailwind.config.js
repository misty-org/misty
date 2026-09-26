/** @type {import('tailwindcss').Config} */
export default {
  content: [new URL("../src/**/*.{html,ts,tsx}", import.meta.url).pathname],
  theme: {
    extend: {
      zIndex: {
        "photo-editor-ai": "2147483350",
      },
    },
  },
  plugins: [],
};
