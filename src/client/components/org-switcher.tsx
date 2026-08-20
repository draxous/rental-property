import { useState } from "react";
import { Building2, Check, ChevronsUpDown, Plus, ShieldCheck } from "lucide-react";
import { useApp } from "@/context";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export function OrgSwitcher() {
  const { organizations, activeOrg, switchOrganization, createOrganization } = useApp();
  const [openCreate, setOpenCreate] = useState(false);
  const [name, setName] = useState("");
  const [seedDemo, setSeedDemo] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      setSaving(true);
      setError(null);
      await createOrganization({
        name: name.trim(),
        seed_demo_data: seedDemo,
      });
      setName("");
      setOpenCreate(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 rounded-lg border bg-sidebar-accent/50 px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-sidebar-accent"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Building2 className="h-4 w-4" />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="truncate text-xs font-semibold leading-none text-foreground">
                  {activeOrg?.name || "Select Organization"}
                </span>
                <span className="truncate text-[10px] text-muted-foreground mt-0.5">
                  B2B Organization
                </span>
              </div>
            </div>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
            Organizations
          </DropdownMenuLabel>
          {organizations.map((org) => {
            const isSelected = activeOrg?.id === org.id;
            return (
              <DropdownMenuItem
                key={org.id}
                onClick={() => switchOrganization(org.id)}
                className="flex items-center justify-between cursor-pointer"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate text-sm font-medium">{org.name}</span>
                </div>
                {isSelected && <Check className="h-4 w-4 text-primary shrink-0 ml-2" />}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setOpenCreate(true)}
            className="flex items-center gap-2 cursor-pointer text-primary focus:text-primary font-medium"
          >
            <Plus className="h-4 w-4" />
            <span>Create Organization</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={openCreate} onOpenChange={setOpenCreate}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleCreate}>
            <DialogHeader>
              <DialogTitle>New Organization</DialogTitle>
              <DialogDescription>
                Add a new organization to manage properties, tenants, leases, and operations in a completely isolated workspace.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              {error && (
                <div className="rounded-md bg-destructive/15 p-3 text-xs text-destructive">
                  {error}
                </div>
              )}
              <div className="grid gap-2">
                <Label htmlFor="org-name">Organization Name</Label>
                <Input
                  id="org-name"
                  placeholder="e.g. Apex Property Management"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              <div className="flex items-center gap-2.5 pt-1">
                <input
                  type="checkbox"
                  id="seed-demo"
                  checked={seedDemo}
                  onChange={(e) => setSeedDemo(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <Label htmlFor="seed-demo" className="text-xs font-normal cursor-pointer">
                  Seed sample property & vendor data for instant testing
                </Label>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpenCreate(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !name.trim()}>
                {saving ? "Creating…" : "Create Organization"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
