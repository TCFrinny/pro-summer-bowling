/**
 * Public `/seasons` layout route. Renders only `<Outlet />` so that
 * `/seasons` (index) and `/seasons/$seasonId/...` children mount correctly.
 * The seasons list lives in `src/routes/seasons.index.tsx`.
 */
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/seasons")({
  head: () => ({
    meta: [
      { title: "Seasons — Pro Summer Singles" },
      { name: "description", content: "Every season in the Pro Summer Singles duckpin league — current and archived." },
    ],
  }),
  component: SeasonsLayout,
});

function SeasonsLayout() {
  return <Outlet />;
}
