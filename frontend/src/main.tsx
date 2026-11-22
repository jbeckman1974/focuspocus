import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Entry from "./Entry.tsx";
import { ensureAppWorker } from "./pwa/registration.ts";

// The public shell can open offline. A separate trusted-device choice controls private data.
if (import.meta.env.PROD && ["/app/", "/"].includes(window.location.pathname)) {
  void ensureAppWorker().catch(() => {
    // The normal online workspace still works when the browser denies installation.
  });
}

const root = document.getElementById("root");
if (root === null) throw new Error("The application root is missing.");

createRoot(root).render(
  <StrictMode>
    <Entry />
  </StrictMode>,
);
