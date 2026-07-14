import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/leaderboards")({
  head: () => ({
    meta: [
      { title: "Leaderboards — Pro Summer Singles" },
      {
        name: "description",
        content:
          "Standard leaderboards derived from every saved frame linescore — scratch, credited handicap, and volume boards.",
      },
      { property: "og:title", content: "Leaderboards — Pro Summer Singles" },
      {
        property: "og:description",
        content:
          "Scratch (roster-only) and points/HCP (credited) leaders across the 2026 Summer season.",
      },
    ],
  }),
  component: () => <Outlet />,
});
