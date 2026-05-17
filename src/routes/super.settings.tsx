import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/super/settings")({
  beforeLoad: () => { throw redirect({ to: "/admin/settings" }); },
  component: () => null,
});
