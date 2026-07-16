/** Compatibility redirect: old /seasons/$seasonId/results → /weekly-results. */
import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/seasons/$seasonId/results")({
  component: ResultsRedirect,
});

function ResultsRedirect() {
  const { seasonId } = Route.useParams();
  return <Navigate to="/seasons/$seasonId/weekly-results" params={{ seasonId }} replace />;
}
