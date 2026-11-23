import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { publicShell } from "./src/pwa/build.ts";

function fluentIconNotice(): Plugin {
  return {
    name: "focuspocus-fluent-icon-notice",
    apply: "build",
    async writeBundle({ dir }) {
      if (!dir) throw new Error("A build directory is required for notices.");
      const file = join(dir, "app", "third-party-licenses.json");
      const entries: { name: string; text?: string }[] = JSON.parse(
        await readFile(file, "utf8"),
      );
      const icons = entries.find(
        (entry) => entry.name === "@fluentui/react-icons",
      );
      if (!icons || icons.text) return;
      // The published icon tarball declares MIT but omits Microsoft's license file.
      const upstream = new URL(
        "./src/licenses/fluent-system-icons.LICENSE",
        import.meta.url,
      );
      icons.text = await readFile(upstream, "utf8");
      await writeFile(file, JSON.stringify(entries, null, 2) + "\n");
    },
  };
}

export default defineConfig({
  plugins: [publicShell(), fluentIconNotice()],
  build: {
    license: { fileName: "app/third-party-licenses.json" },
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
