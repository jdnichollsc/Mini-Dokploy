import { Button } from "@mini-dokploy/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@mini-dokploy/ui/components/card";
import { Input } from "@mini-dokploy/ui/components/input";
import { Label } from "@mini-dokploy/ui/components/label";
import { Textarea } from "@mini-dokploy/ui/components/textarea";
import { useRouter } from "next/router";
import { useState } from "react";
import { toast } from "sonner";

import { trpc } from "@/utils/trpc";

export default function NewDeploymentPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [dockerfilePath, setDockerfilePath] = useState("Dockerfile");
  const [exposedPort, setExposedPort] = useState(3000);
  const [labelsJson, setLabelsJson] = useState("{}");

  const ai = trpc.ai.available.useQuery();
  const suggest = trpc.ai.suggestDockerfile.useMutation({
    onSuccess: (s) => {
      setDockerfilePath(s.dockerfilePath);
      setExposedPort(s.exposedPort);
      toast.success(`AI suggestion: ${s.reasoning}`);
    },
    onError: (e) => toast.error(e.message),
  });
  const create = trpc.deployments.create.useMutation({
    onSuccess: ({ id }) => {
      toast.success("Deployment queued");
      router.push(`/deployments/${id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let customLabels: Record<string, string> | undefined;
    try {
      const parsed = labelsJson.trim() ? JSON.parse(labelsJson) : {};
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const entries = Object.entries(parsed).filter(([, v]) => typeof v === "string") as [
          string,
          string,
        ][];
        if (entries.length > 0) customLabels = Object.fromEntries(entries);
      }
    } catch {
      toast.error("Custom labels must be valid JSON");
      return;
    }
    create.mutate({ name, repoUrl, branch, dockerfilePath, exposedPort, customLabels });
  };

  return (
    <div className="container mx-auto max-w-2xl px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle>New deployment</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="my-app"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="repo">Git repository URL</Label>
              <div className="flex gap-2">
                <Input
                  id="repo"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  required
                  placeholder="https://github.com/owner/repo"
                />
                {ai.data?.available && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => suggest.mutate({ repoUrl, branch })}
                    disabled={!repoUrl || suggest.isPending}
                  >
                    {suggest.isPending ? "Asking…" : "AI auto-detect"}
                  </Button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="branch">Branch</Label>
                <Input
                  id="branch"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="port">Exposed port</Label>
                <Input
                  id="port"
                  type="number"
                  min={1}
                  max={65535}
                  value={exposedPort}
                  onChange={(e) => setExposedPort(Number(e.target.value))}
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="df">Dockerfile path</Label>
              <Input
                id="df"
                value={dockerfilePath}
                onChange={(e) => setDockerfilePath(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="labels">Custom Docker labels (JSON, optional)</Label>
              <Textarea
                id="labels"
                value={labelsJson}
                onChange={(e) => setLabelsJson(e.target.value)}
                placeholder={`{\n  "com.example.team": "infra"\n}`}
                rows={5}
              />
              <p className="text-xs text-muted-foreground">
                Merged with the Traefik labels Mini-Dokploy generates. The platform
                strips any label that would hijack routing or override another tenant.
              </p>
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? "Queuing…" : "Deploy"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
