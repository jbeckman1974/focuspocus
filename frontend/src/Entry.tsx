import App from "./App.tsx";
import { AccountApp } from "./persistent/AccountApp.tsx";

export default function Entry() {
  const route = window.location.pathname.replace(/\/+$/, "");
  const persistent = route === "/app" || (route === "" && import.meta.env.PROD);
  return persistent ? <AccountApp /> : <App />;
}
