import { Button } from "@mini-dokploy/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@mini-dokploy/ui/components/card";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/status-badge";
import { trpc } from "@/utils/trpc";

export default function DeploymentDetailPage() {
  const router = useRouter();
  const id = typeof router.query.id === "string" ? router.query.id : null;
  const detail = trpc.deployments.get.useQuery(
    { id: id ?? "" },
    { enabled: !!id, refetchInterval: 3000 },
  );
  const utils = trpc.useUtils();
  const redeploy = trpc.deployments.redeploy.useMutation({
    onSuccess: () => {
      toast.success("Redeploy queued");
      utils.deployments.get.invalidate({ id: id! });
    },
    onError: (e) => toast.error(e.message),
  });
  const destroy = trpc.deployments.destroy.useMutation({
    onSuccess: () => {
      toast.success("Destroy queued");
      utils.deployments.get.invalidate({ id: id! });
    },
    onError: (e) => toast.error(e.message),
  });

  // Live logs for the latest running run. Falls back to "no live logs" if the
  // run has already completed.
  const latestRun = detail.data?.runs[0];
  const [logs, setLogs] = useState<string>("");
  useEffect(() => {
    if (!latestRun || latestRun.status !== "running") return;
    setLogs("");
    const proto = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${window.location.host}/api/ws/logs/${latestRun.runId}`;
    let ws: WebSocket | undefined;
    try {
      ws = new WebSocket(url);
      ws.onmessage = (e) => setLogs((prev) => prev + String(e.data));
      ws.onerror = () => setLogs((prev) => prev + "\n[live logs disconnected]\n");
    } catch {
      // Bonus feature; ignore failures.
    }
    return () => ws?.close();
  }, [latestRun?.runId, latestRun?.status]);

  if (!id || detail.isLoading) return <div className="p-8 text-sm">Loading…</div>;
  if (detail.error) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-8">
        <p className="text-sm text-red-600">{detail.error.message}</p>
      </div>
    );
  }
  const d = detail.data!.deployment;
  const runs = detail.data!.runs;

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">
            <Link href="/deployments" className="underline">
              ← Deployments
            </Link>
          </p>
          <h1 className="text-2xl font-semibold">{d.name}</h1>
          <p className="text-sm text-muted-foreground">{d.repoUrl}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={d.status} />
          <Button
            size="sm"
            variant="outline"
            onClick={() => redeploy.mutate({ id: d.id })}
            disabled={redeploy.isPending}
          >
            Redeploy
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (confirm(`Destroy ${d.name}?`)) destroy.mutate({ id: d.id });
            }}
            disabled={destroy.isPending}
          >
            Destroy
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configuration</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          <p>
            <strong>URL:</strong>{" "}
            {d.url ? (
              <a href={d.url} target="_blank" rel="noreferrer noopener" className="text-sky-600 underline">
                {d.url}
              </a>
            ) : (
              <span className="text-muted-foreground">— (not deployed yet)</span>
            )}
          </p>
          <p>
            <strong>Branch:</strong> {d.branch}
          </p>
          <p>
            <strong>Dockerfile:</strong> <code>{d.dockerfilePath}</code>
          </p>
          <p>
            <strong>Port:</strong> {d.exposedPort}
          </p>
          {d.imageTag && (
            <p>
              <strong>Image:</strong> <code>{d.imageTag}</code>
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Live build/deploy logs</CardTitle>
        </CardHeader>
        <CardContent>
          {latestRun?.status === "running" ? (
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs bg-zinc-950 text-zinc-100 p-3 rounded">
              {logs || "Waiting for output…"}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">
              No active run. {latestRun?.failureReason && (
                <span className="text-red-600">Last failure: {latestRun.failureReason}</span>
              )}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Run history</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">When</th>
                <th className="px-4 py-2 text-left">Trigger</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Detail</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-b-0 align-top">
                  <td className="px-4 py-2 text-muted-foreground">
                    {new Date(r.startedAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2">{r.trigger}</td>
                  <td className="px-4 py-2">{r.status}</td>
                  <td className="px-4 py-2 max-w-md break-words">
                    {r.failureReason ?? <span className="text-muted-foreground">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
