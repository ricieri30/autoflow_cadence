/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Bricolage Grotesque"', "system-ui", "sans-serif"],
        sans: ['"Hanken Grotesk"', "system-ui", "sans-serif"],
        mono: ['"Spline Sans Mono"', "ui-monospace", "monospace"],
      },
      colors: {
        // Identidade "Cadence" — verde-sinal + lilás sobre tinta quase-preta.
        ink:    { DEFAULT: "#0B0F0E", 2: "#0F1514" },
        raised: { DEFAULT: "#131A18", 2: "#172120" },
        hair:   { DEFAULT: "#1F2A28", 2: "#2A3735" },
        bone:   "#E9EDEB",
        mist:   "#B9C4C0",
        mut:    "#76847F",
        signal: { DEFAULT: "#3FE0A2", dim: "#1c6b4d" },
        // "brand" mantido como o lilás secundário (compatível com telas ainda não migradas)
        brand: {
          50:"#f5f3ff",100:"#ede9fe",200:"#ddd6fe",300:"#c4b5fd",400:"#a78bfa",
          500:"#8b5cf6",600:"#7c3aed",700:"#6d28d9",800:"#5b21b6",900:"#4c1d95",950:"#2e1065",
        },
        gold: { 300:"#f3d98b",400:"#e8c25f",500:"#d4a23a" },
      },
      boxShadow: { premium: "0 10px 40px -12px rgba(63,224,162,0.30)" },
    },
  },
  plugins: [],
};
