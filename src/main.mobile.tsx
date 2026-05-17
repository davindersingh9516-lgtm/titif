import ReactDOM from "react-dom/client";
import { RouterProvider, createRouter, createHashHistory } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { routeTree } from "./routeTree.gen";
import { supabase } from "@/integrations/supabase/client";
import "./styles.css";

console.error("[T] main.mobile start");

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

const router = createRouter({
  routeTree,
  context: { queryClient },
  history: createHashHistory(),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// Pre-warm Supabase BEFORE React renders so the client + session cache is
// ready before any component mounts.
supabase.auth.getSession().then(() => console.error("[T] supabase getSession settled"));

console.error("[T] rendering React");
ReactDOM.createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />,
);
console.error("[T] React render called");

// AuthProvider dispatches "tiffin:ready" when loading:false (auth settled).
// 4-second safety timeout in case the event never fires.
console.error("[T] setting up appReady");
const appReady = new Promise<void>((resolve) => {
  window.addEventListener("tiffin:ready", () => {
    console.error("[T] tiffin:ready event received");
    resolve();
  }, { once: true });
  setTimeout(() => {
    console.error("[T] appReady 4s timeout fired");
    resolve();
  }, 4_000);
});

// Starts the WebView ↔ IME Binder IPC handshake by briefly focusing a
// hidden input. Skips if a real user input already has focus so the resume
// listener never steals focus from an input the user is actively in.
function warmIme() {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    return;
  }
  const warm = document.createElement("input");
  warm.type = "text";
  warm.setAttribute("tabindex", "-1");
  warm.setAttribute("aria-hidden", "true");
  warm.setAttribute("autocomplete", "off");
  warm.style.cssText =
    "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;" +
    "opacity:0;pointer-events:none;";
  document.body.appendChild(warm);
  warm.focus();
  // Remove (not blur) the element one rAF later. Removing a focused element
  // moves focus to body without transferring it to the next focusable sibling,
  // so we never accidentally steal focus from a real input.
  requestAnimationFrame(() => {
    if (document.body.contains(warm)) document.body.removeChild(warm);
  });
}

appReady.then(() => {
  console.error("[T] appReady resolved — removing overlay");
  document.getElementById("app-loading")?.remove();

  const isAndroid =
    typeof (window as any).Capacitor !== "undefined" &&
    (window as any).Capacitor.getPlatform?.() === "android";

  if (isAndroid) {
    warmIme();
    // Motorola's moto_freezer suspends the entire process (severing Binder
    // IPC) whenever the screen turns off, even for the top app. On screen
    // wake the process is unfrozen cold, so the warm channel is gone.
    // Re-establish it every time the Activity resumes (Cordova/Capacitor
    // fire the "resume" document event on onResume()).
    document.addEventListener("resume", warmIme, false);
  }
});
