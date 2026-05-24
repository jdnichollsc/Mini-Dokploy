import { Button } from "@mini-dokploy/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@mini-dokploy/ui/components/card";
import { Input } from "@mini-dokploy/ui/components/input";
import { Label } from "@mini-dokploy/ui/components/label";
import { useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";

export default function OrganizationsPage() {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: orgs, refetch } = authClient.useListOrganizations();
  const { data: active } = authClient.useActiveOrganization();

  const onCreate = async () => {
    if (!name.trim() || !slug.trim()) return;
    setBusy(true);
    const result = await authClient.organization.create({ name, slug });
    setBusy(false);
    if (result.error) {
      toast.error(result.error.message ?? "Could not create organization");
      return;
    }
    setName("");
    setSlug("");
    if (result.data?.id) {
      await authClient.organization.setActive({ organizationId: result.data.id });
    }
    await refetch();
    toast.success("Organization created");
  };

  const onActivate = async (id: string) => {
    await authClient.organization.setActive({ organizationId: id });
    toast.success("Active organization updated");
  };

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8 space-y-6">
      <h1 className="text-2xl font-semibold">Organizations</h1>
      <Card>
        <CardHeader>
          <CardTitle>Create a new organization</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="org-name">Name</Label>
            <Input
              id="org-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!slug) setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-"));
              }}
              placeholder="Acme Inc"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="org-slug">Slug</Label>
            <Input
              id="org-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="acme"
            />
          </div>
          <Button onClick={onCreate} disabled={busy}>
            {busy ? "Creating…" : "Create organization"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your organizations</CardTitle>
        </CardHeader>
        <CardContent>
          {!orgs || orgs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No organizations yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {orgs.map((o) => (
                <li key={o.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-medium">{o.name}</p>
                    <p className="text-xs text-muted-foreground">/{o.slug}</p>
                  </div>
                  {active?.id === o.id ? (
                    <span className="text-xs text-emerald-600">Active</span>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => onActivate(o.id)}>
                      Activate
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
