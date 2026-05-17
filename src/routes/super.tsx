import { createFileRoute, redirect } from "@tanstack/react-router";

// Super admin panel removed — all functionality lives in /admin now.
export const Route = createFileRoute("/super")({
  beforeLoad: () => { throw redirect({ to: "/admin" }); },
  component: () => null,
});
