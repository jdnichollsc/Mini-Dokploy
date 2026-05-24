import type { DeploymentStatus } from "@mini-dokploy/core";
import { Badge } from "@mini-dokploy/ui/components/badge";

const VARIANT: Record<DeploymentStatus, React.ComponentProps<typeof Badge>["variant"]> = {
  pending: "info",
  building: "info",
  deploying: "info",
  running: "success",
  failed: "danger",
  stopped: "warn",
};

export function StatusBadge({ status }: { status: DeploymentStatus }) {
  return <Badge variant={VARIANT[status]}>{status}</Badge>;
}
