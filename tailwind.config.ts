import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#05080f",
          900: "#080d17",
          850: "#0b1220",
          800: "#0f1728",
          700: "#172236",
        },
        neon: {
          300: "#6ee7b7",
          400: "#34d399",
          500: "#10b981",
        },
        lime: {
          400: "#a3e635",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
        mono: [
          "SFMono-Regular",
          "Consolas",
          "Liberation Mono",
          "Menlo",
          "monospace",
        ],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(52, 211, 153, 0.14), 0 18px 50px -24px rgba(16, 185, 129, 0.45)",
        panel: "0 24px 80px -40px rgba(0, 0, 0, 0.65)",
      },
      backgroundImage: {
        "radial-grid":
          "radial-gradient(circle at 1px 1px, rgba(148, 163, 184, 0.12) 1px, transparent 0)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in": {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        pulseSoft: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.45" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.45s cubic-bezier(0.22, 1, 0.36, 1) both",
        "slide-in": "slide-in 0.35s cubic-bezier(0.22, 1, 0.36, 1) both",
        "pulse-soft": "pulseSoft 2.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
