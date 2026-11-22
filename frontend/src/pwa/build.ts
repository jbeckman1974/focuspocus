import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Plugin } from "vite";
import { appIcon } from "./icons.ts";

const manifest = {
  id: "/app/",
  start_url: "/app/",
  scope: "/app/",
  name: "FocusPocus",
  short_name: "FocusPocus",
  display: "standalone",
  background_color: "#fffefa",
  theme_color: "#245745",
  icons: [192, 512].map((size) => ({
    src: "/app/icon-" + size + ".png",
    sizes: size + "x" + size,
    type: "image/png",
    purpose: "any maskable",
  })),
};

export function publicShell(): Plugin {
  return {
    name: "focuspocus-public-shell",
    apply: "build",
    async writeBundle({ dir }) {
      if (!dir) throw new Error("An application build directory is required.");
      const shell = join(dir, "app");
      const assets = join(dir, "assets");
      await writeFile(
        join(shell, "manifest.webmanifest"),
        JSON.stringify(manifest),
      );
      for (const size of [192, 512]) {
        await writeFile(join(shell, "icon-" + size + ".png"), appIcon(size));
      }
      const files: Record<string, string> = {
        "/app/": join(dir, "index.html"),
        "/app/manifest.webmanifest": join(shell, "manifest.webmanifest"),
        "/app/icon-192.png": join(shell, "icon-192.png"),
        "/app/icon-512.png": join(shell, "icon-512.png"),
      };
      for (const file of (await readdir(assets)).sort()) {
        if (/^[\w-]+\.(?:js|css|svg|woff2)$/.test(file)) {
          files["/assets/" + file] = join(assets, file);
        }
      }
      const resources: Record<string, string> = {};
      for (const [url, file] of Object.entries(files)) {
        const hash = createHash("sha256").update(await readFile(file));
        resources[url] = "sha256-" + hash.digest("base64");
      }
      const workerPath = join(shell, "sw.js");
      const worker = await readFile(workerPath, "utf8");
      const version = createHash("sha256")
        .update(JSON.stringify(resources))
        .update(worker)
        .digest("hex");
      await writeFile(
        workerPath,
        "const __FP_SHELL__ = " +
          JSON.stringify({ version, resources }) +
          ";\n" +
          worker,
      );
    },
  };
}
