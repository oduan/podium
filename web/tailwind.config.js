/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0b0d10",
          900: "#111418",
          800: "#181c22",
          700: "#232830",
          600: "#333a45",
          500: "#4a525f",
          400: "#6b7480",
          300: "#9aa4b1",
        },
        accent: {
          DEFAULT: "#6ea8fe",
          soft: "#3b82f6",
        },
      },
    },
  },
  plugins: [],
};
