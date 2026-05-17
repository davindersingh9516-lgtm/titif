import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "path";

export default defineConfig({
  plugins: [
    TanStackRouterVite({
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
    }),
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist-mobile",
    emptyOutDir: true,
    rollupOptions: {
      input: "index.mobile.html",
      output: {
        manualChunks(id) {
          if (id.includes("mapbox-gl")) return "mapbox-gl";
          if (id.includes("recharts") || id.includes("d3-") || id.includes("victory-")) return "charts";
          if (id.includes("@radix-ui")) return "radix";
          if (id.includes("node_modules")) return "vendor";
        },
      },
    },
  },
});
