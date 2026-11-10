import { createFileRoute, redirect } from "@tanstack/react-router";

import { TaskBoardPage } from "../components/tasks/TaskBoardPage";

export const Route = createFileRoute("/tasks")({
  beforeLoad: ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: TaskBoardPage,
});
