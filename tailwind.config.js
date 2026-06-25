/** @type {import('tailwindcss').Config} */
// "Elango's Logbook" design system — the app's existing Tailwind color names are
// remapped onto the new identity, so every component reskins without per-element
// edits. Semantics are preserved: slate = warm stone/ink ground & text, emerald =
// peacock (structure/"alive"), amber = marigold (energy/support), rose = kumkum
// (alert), sky = dusty weather blue, indigo/violet = dusk (votes/rest/memory).
module.exports = {
  content: [
    "./src/app/**/*.{js,jsx}",
    "./src/components/**/*.{js,jsx}",
    "./src/lib/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "Segoe UI", "Roboto", "sans-serif"],
        serif: ['"Iowan Old Style"', '"Palatino Linotype"', "Palatino", '"Book Antiqua"', "Georgia", "serif"],
        mono: ["ui-monospace", '"SF Mono"', '"JetBrains Mono"', "Menlo", "Consolas", "monospace"],
      },
      colors: {
        // neutral — warm limewash stone → warm-black ink (was slate)
        slate: {
          50: "#F3EDE0", 100: "#E7DFCE", 200: "#DDD3BF", 300: "#C9BFA8",
          400: "#9C9079", 500: "#7A7160", 600: "#5A5346", 700: "#3A352B",
          800: "#2A261E", 900: "#211E18",
        },
        // peacock — structure, links, "alive" (was emerald)
        emerald: {
          50: "#E6F0EE", 100: "#C7E4DE", 200: "#9FD2CA", 300: "#5FB8AC",
          400: "#1F8C80", 500: "#0E6E64", 600: "#0E6E64", 700: "#0B5952",
          800: "#084740", 900: "#06352F",
        },
        // marigold — energy, support, warmth, live values (was amber)
        amber: {
          50: "#F8EFD9", 100: "#F2DEB0", 200: "#ECCB86", 300: "#E6B85E",
          400: "#E29A24", 500: "#DC8A12", 600: "#B4700C", 700: "#8E5709",
          800: "#6F4408", 900: "#553309",
        },
        // kumkum — alert / critical, sparing (was rose)
        rose: {
          50: "#F5E3DF", 100: "#EBC8C1", 200: "#DCA096", 300: "#C96E5E",
          400: "#BD5142", 500: "#B0392C", 600: "#9A3025", 700: "#84281F",
          800: "#6B2019", 900: "#551913",
        },
        // dusty weather blue (was sky)
        sky: {
          50: "#EAF1F4", 100: "#D2E2E8", 200: "#AEC9D4", 300: "#84AABA",
          400: "#5688A0", 500: "#3E7A93", 600: "#356A82", 700: "#2C5468",
          800: "#264656", 900: "#213B47",
        },
        // dusk — votes, resting, evening (was indigo)
        indigo: {
          50: "#ECEAF3", 100: "#DBD7E8", 200: "#BFB8D3", 300: "#9A8FBA",
          400: "#766A9C", 500: "#5B5080", 600: "#4B4068", 700: "#3C3253",
          800: "#2E2640", 900: "#1B2030",
        },
        // plum — scrapbook / memory (was violet)
        violet: {
          50: "#F1E9EE", 100: "#E1CEDA", 200: "#C9A6BB", 300: "#AC7C97",
          400: "#955F7E", 500: "#7E4566", 600: "#6B3957", 700: "#562D46",
          800: "#432338", 900: "#33192B",
        },
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.35s ease-out",
      },
    },
  },
  plugins: [],
};
