import type { Preview } from "@storybook/react-vite";

import "../src/design-system/tokens/tokens.css";
import "../src/design-system/theme/theme.css";

const preview: Preview = {
  initialGlobals: { viewport: { value: "desktop", isRotated: false } },
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
        order: ["Foundation", "Primitives", "Starter Components", "Patterns"],
      },
    },
  },
};

export default preview;
