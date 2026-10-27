import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0b0e14",
          900: "#11151d",
          850: "#161b25",
          800: "#1c222e",
          700: "#2a3140",
          600: "#3b4356",
        },
        paper: {
          50: "#f7f8fa",
          100: "#eef0f4",
          200: "#dde1e9",
          300: "#c3c9d6",
        },
        brand: {
          400: "#8b93ff",
          500: "#6366f1",
          600: "#5457e8",
        },
      },
      fontFamily: {
        sans: ["ui-sans-system", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
      },
      keyframes: {
        "msg-in": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        shake: {
          "0%,100%": { transform: "translateX(0)" },
          "20%,60%": { transform: "translateX(-6px)" },
          "40%,80%": { transform: "translateX(6px)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
      animation: {
        "msg-in": "msg-in .22s ease-out both",
        shake: "shake .4s ease-in-out",
        "fade-in": "fade-in .18s ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;
