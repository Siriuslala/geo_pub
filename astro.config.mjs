import { resolve } from "node:path";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://siriuslala.github.io",
  base: "/geo_pub",
  output: "static",
  trailingSlash: "always",
  vite: {
    server: {
      hmr: process.env.GEO_PUB_HMR === "1",
    },
    plugins: [
      {
        name: "watch-country-notes",
        configureServer(server) {
          const countriesDir = resolve("src/content/countries");
          const reloadCountryPages = (file) => {
            if (!file.replaceAll("\\", "/").includes("/src/content/countries/")) {
              return;
            }
            for (const mod of server.moduleGraph.idToModuleMap.values()) {
              const id = mod.id ?? "";
              if (
                id.includes("src/lib/countries") ||
                id.includes("src/pages/[country]") ||
                id.includes("src/components/WorldMap.astro")
              ) {
                server.moduleGraph.invalidateModule(mod);
              }
            }
            server.ws.send({ type: "full-reload" });
          };

          server.watcher.add(countriesDir);
          server.watcher.on("add", reloadCountryPages);
          server.watcher.on("unlink", reloadCountryPages);
          server.watcher.on("change", reloadCountryPages);
        },
      },
    ],
    define: {
      __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
    },
  },
});
