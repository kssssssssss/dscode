import { createFileRoute, redirect } from "@tanstack/react-router";

import { TaskBoardPage } from "../components/tasks/TaskBoardPage";

export const Route = createFileRoute("/project-board/$projectKey")({
  validateSearch: (search: Record<string, unknown>): { checkout?: string } =>
    typeof search.checkout === "string" ? { checkout: search.checkout } : {},
  beforeLoad: ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: ProjectBoardRoute,
});

function ProjectBoardRoute() {
  const { projectKey } = Route.useParams();
  const { checkout } = Route.useSearch();
  return <TaskBoardPage key={projectKey} projectKey={projectKey} checkout={checkout} />;
}
