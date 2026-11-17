import type { StorybookConfig } from "@storybook/react-vite";

// Storybook działa na Vite niezależnie od bundlera Next.js; nie zmienia stacku aplikacji.
const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  stories: ["../src/design-system/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-a11y"],
  core: { disableTelemetry: true },
};

export default config;
