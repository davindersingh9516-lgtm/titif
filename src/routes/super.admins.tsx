import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/super/admins")({
  beforeLoad: () => { throw redirect({ to: "/admin/team" }); },
  component: () => null,
});
