import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/seasons")({
  head: () => ({ meta: [{ name: "robots", content: "noindex" }] }),
  component: () => <Outlet />,
});
