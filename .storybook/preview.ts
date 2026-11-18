import type { Preview } from "@storybook/react-vite";

import "../src/design-system/fonts/fonts.css";
import "../src/design-system/tokens/tokens.css";
import "../src/design-system/theme/theme.css";

// Motyw to klasa na <html>, jak w aplikacji (.theme-dark / .theme-light); start zawsze nocny.
const preview: Preview = {
  globalTypes: {
    theme: {
      description: "Motyw",
      toolbar: {
        title: "Motyw",
        icon: "circlehollow",
        items: [
          { value: "dark", title: "Nocny" },
          { value: "light", title: "Jasny" },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const theme = context.globals.theme === "light" ? "light" : "dark";
      const root = document.documentElement;
      root.classList.remove("theme-dark", "theme-light");
      root.classList.add(`theme-${theme}`);
      return Story();
    },
  ],
  initialGlobals: { theme: "dark", viewport: { value: "desktop", isRotated: false } },
  parameters: {
    layout: "fullscreen",
    controls: { expanded: true },
    viewport: {
      options: {
        mobile: {
          name: "Mobile (360×740)",
          styles: { width: "360px", height: "740px" },
          type: "mobile",
        },
        mobileSmall: {
          name: "Mobile (320×640)",
          styles: { width: "320px", height: "640px" },
          type: "mobile",
        },
        desktop: {
          name: "Desktop (1280×800)",
          styles: { width: "1280px", height: "800px" },
          type: "desktop",
        },
      },
    },
    // Lekka kontrola dostępności (axe) w panelu Accessibility; bez blokowania buildu.
    a11y: { test: "todo" },
    options: {
      storySort: {
        order: ["Foundation", "Primitives", "Krajozbiór Components", "Patterns"],
      },
    },
  },
};

export default preview;
