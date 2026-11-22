import { defineConfig } from "vite";
import { publicShell } from "./src/pwa/build.ts";

export default defineConfig({
  plugins: [publicShell()],
  build: {
    rolldownOptions: {
      input: {
        index: "index.html",
        shellWorker: "src/pwa/worker.ts",
        legacyPush: "src/persistent/tools/notification-worker.ts",
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === "shellWorker") return "app/sw.js";
          if (chunk.name === "legacyPush") return "app/legacy-push.js";
          return "assets/[name]-[hash].js";
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": process.env.FOCUSPOCUS_API_ORIGIN ?? "http://127.0.0.1:8000",
    },
  },
});
