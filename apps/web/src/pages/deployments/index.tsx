import { Button } from "@mini-dokploy/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@mini-dokploy/ui/components/card";
import Link from "next/link";
import { toast } from "sonner";

import { StatusBadge } from "@/components/status-badge";
import { trpc } from "@/utils/trpc";

export default function DeploymentsPage() {
  const list = trpc.deployments.list.useQuery(undefined, { refetchInterval: 5000 });
  const utils = trpc.useUtils();
  const redeploy = trpc.deployments.redeploy.useMutation({
    onSuccess: () => {
      toast.success("Redeploy queued");
      utils.deployments.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const destroy = trpc.deployments.destroy.useMutation({
    onSuccess: () => {
      toast.success("Destroy queued");
      utils.deployments.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  if (list.error) {
    const isOrgRequired = list.error.data?.code === "FORBIDDEN";
    return (
      <div className="container mx-auto max-w-3xl px-4 py-8">
        <Card>
          <CardContent className="py-6">
            <p className="text-sm">
              {isOrgRequired ? (
                <>
                  Select or create an organization first.{" "}
                  <Link href="/organizations" className="underline">
                    Go to organizations
                  </Link>
                  .
                </>
              ) : (
                list.error.message
              )}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Deployments</h1>
        <Link href="/deployments/new">
          <Button>New deployment</Button>
        </Link>
      </div>

      {!list.data || list.data.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No deployments yet — create your first one.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{list.data.length} deployment(s)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Name</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-left">URL</th>
                  <th className="px-4 py-2 text-left">Updated</th>
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((d) => (
                  <tr key={d.id} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/deployments/${d.id}`} className="hover:underline">
                        {d.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={d.status} />
                    </td>
                    <td className="px-4 py-3">
                      {d.url ? (
                        <a
                          href={d.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-sky-600 underline"
                        >
                          {d.url.replace(/^https?:\/\//, "")}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(d.updatedAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
