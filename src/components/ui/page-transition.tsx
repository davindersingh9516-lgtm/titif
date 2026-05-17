import { useLocation } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

/**
 * Lightweight, GPU-friendly route transition wrapper.
 * Re-triggers a fade-up on each pathname change without unmounting children.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [key, setKey] = useState(pathname);
  useEffect(() => { setKey(pathname); }, [pathname]);
  return (
    <div key={key} className="animate-fade-up will-change-transform">
      {children}
    </div>
  );
}
