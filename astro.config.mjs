import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://siriuslala.github.io",
  base: "/geo_pub",
  output: "static",
  trailingSlash: "always",
  vite: {
    define: {
      __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
    },
  },
});
