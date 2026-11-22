import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Entry from "./Entry.tsx";

const root = document.getElementById("root");
if (root === null) throw new Error("The application root is missing.");

createRoot(root).render(
  <StrictMode>
    <Entry />
  </StrictMode>,
);
