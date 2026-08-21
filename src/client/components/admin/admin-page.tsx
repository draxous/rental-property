import { useEffect, useState } from "react";
import {
  CreditCard,
  Building2,
  Lock,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Sliders,
  ShieldAlert,
  ArrowRightLeft,
} from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PaymentGateway, OrgPaymentAssignment, FinancialTransaction } from "@/types";

export function AdminPage() {
  const [gateways, setGateways] = useState<PaymentGateway[]>([]);
  const [assignments, setAssignments] = useState<OrgPaymentAssignment[]>([]);
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      setLoading(true);
      const [gRes, aRes, tRes] = await Promise.all([
        api<{ gateways: PaymentGateway[] }>("GET", "/api/admin/gateways"),
        api<{ assignments: OrgPaymentAssignment[] }>("GET", "/api/admin/org-assignments"),
        api<{ transactions: FinancialTransaction[] }>("GET", "/api/admin/transactions"),
      ]);
      setGateways(gRes.gateways);
      setAssignments(aRes.assignments);
      setTransactions(tRes.transactions);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto w-full max-w-6xl space-y-6 p-6">
        <header className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">Main Organization Admin Panel</h1>
              <Badge variant="secondary" className="flex items-center gap-1 bg-amber-500/10 text-amber-600 border-amber-500/20">
                <Lock className="h-3 w-3" /> Admin Restricted
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              Platform-wide payment gateway credentials, organization assignments, and financial transaction audit ledger.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
          </Button>
        </header>

        <Tabs defaultValue="gateways">
          <TabsList className="grid w-full grid-cols-3 max-w-md">
            <TabsTrigger value="gateways">Payment Gateways</TabsTrigger>
            <TabsTrigger value="assignments">Org Assignments</TabsTrigger>
            <TabsTrigger value="transactions">Financial Audit</TabsTrigger>
          </TabsList>

          <TabsContent value="gateways" className="mt-4">
            <GatewaysTab gateways={gateways} onRefresh={loadData} />
          </TabsContent>

          <TabsContent value="assignments" className="mt-4">
            <OrgAssignmentsTab assignments={assignments} gateways={gateways} onRefresh={loadData} />
          </TabsContent>

          <TabsContent value="transactions" className="mt-4">
            <TransactionsTab transactions={transactions} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ── Gateways Tab ───────────────────────────────────────────────────

function GatewaysTab({
  gateways,
  onRefresh,
}: {
  gateways: PaymentGateway[];
  onRefresh: () => void;
}) {
  const [editing, setEditing] = useState<PaymentGateway | null>(null);

  return (
    <div className="space-y-4">
      <Card className="p-4 bg-muted/40 border-amber-500/20 text-xs text-muted-foreground flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-amber-500 shrink-0" />
        <span>
          Payment Gateway configuration is restricted exclusively to the Main Admin. Organizations cannot view or edit these API keys or merchant credentials.
        </span>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {gateways.map((g) => (
          <Card key={g.id} className="p-5 flex flex-col justify-between space-y-4">
            <div>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <CreditCard className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-base leading-tight">{g.name}</h3>
                    <p className="text-xs text-muted-foreground capitalize mt-0.5">Type: {g.type}</p>
                  </div>
                </div>
                <Badge variant={g.is_enabled ? "default" : "secondary"}>
                  {g.is_enabled ? "Active" : "Disabled"}
                </Badge>
              </div>

              <div className="mt-4 space-y-2 text-xs">
                <div className="flex justify-between border-b pb-1.5">
                  <span className="text-muted-foreground">Mode</span>
                  <span className="font-mono font-medium">{g.config.sandbox === "false" ? "Production" : "Sandbox"}</span>
                </div>
                {Object.entries(g.config).map(([key, val]) => (
                  <div key={key} className="flex justify-between border-b pb-1.5">
                    <span className="text-muted-foreground capitalize">{key.replace(/_/g, " ")}</span>
                    <span className="font-mono truncate max-w-[180px]">{val || "—"}</span>
                  </div>
                ))}
              </div>
            </div>

            <Button size="sm" variant="outline" className="w-full" onClick={() => setEditing(g)}>
              <Sliders className="mr-1.5 h-3.5 w-3.5" /> Configure Gateway Credentials
            </Button>
          </Card>
        ))}
      </div>

      {editing && (
        <ConfigureGatewayDialog
          gateway={editing}
          open={Boolean(editing)}
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          onSuccess={() => {
            setEditing(null);
            onRefresh();
          }}
        />
      )}
    </div>
  );
}

function ConfigureGatewayDialog({
  gateway,
  open,
  onOpenChange,
  onSuccess,
}: {
  gateway: PaymentGateway;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [enabled, setEnabled] = useState(gateway.is_enabled);
  const [config, setConfig] = useState<Record<string, string>>(gateway.config || {});
  const [saving, setSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      await api("PUT", `/api/admin/gateways/${gateway.id}`, {
        is_enabled: enabled,
        config,
      });
      onSuccess();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSave}>
          <DialogHeader>
            <DialogTitle>Configure {gateway.name}</DialogTitle>
            <DialogDescription>
              Set global merchant credentials and sandbox/production API keys for this payment gateway module.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="gw-enabled"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-primary"
              />
              <Label htmlFor="gw-enabled" className="text-sm font-medium cursor-pointer">
                Enable this Payment Gateway Module across platform
              </Label>
            </div>

            {Object.keys(config).map((key) => (
              <div key={key} className="grid gap-1.5">
                <Label htmlFor={`cfg-${key}`} className="text-xs font-medium capitalize">
                  {key.replace(/_/g, " ")}
                </Label>
                {key === "sandbox" ? (
                  <Select value={config[key]} onValueChange={(val) => setConfig({ ...config, [key]: val })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">Sandbox (Test Mode)</SelectItem>
                      <SelectItem value="false">Production (Live Payments)</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id={`cfg-${key}`}
                    value={config[key] || ""}
                    onChange={(e) => setConfig({ ...config, [key]: e.target.value })}
                  />
                )}
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save Configuration"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Org Assignments Tab ────────────────────────────────────────────

function OrgAssignmentsTab({
  assignments,
  gateways,
  onRefresh,
}: {
  assignments: OrgPaymentAssignment[];
  gateways: PaymentGateway[];
  onRefresh: () => void;
}) {
  const { organizations } = useApp();
  const [updatingOrg, setUpdatingOrg] = useState<number | null>(null);

  const handleAssign = async (orgId: number, gatewayId: string) => {
    try {
      setUpdatingOrg(orgId);
      await api("PUT", `/api/admin/org-assignments/${orgId}`, { gateway_id: gatewayId });
      onRefresh();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setUpdatingOrg(null);
    }
  };

  return (
    <Card className="p-5 space-y-4">
      <div>
        <h2 className="text-base font-semibold">Organization Payment Assignments</h2>
        <p className="text-xs text-muted-foreground">
          Assign which payment gateway module (PayHere Sri Lanka or LankaPay) handles recurring card & direct debit payments for each organization.
        </p>
      </div>

      <div className="divide-y rounded-md border">
        {organizations.map((org) => {
          const assign = assignments.find((a) => a.org_id === org.id);
          const currentGatewayId = assign?.gateway_id || "payhere";

          return (
            <div key={org.id} className="flex items-center justify-between p-4 gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Building2 className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-medium text-sm">{org.name}</h3>
                  <p className="text-xs text-muted-foreground">ID: {org.id} · {org.slug}</p>
                </div>
              </div>

              <div className="flex items-center gap-3 min-w-[240px]">
                <Select
                  value={currentGatewayId}
                  disabled={updatingOrg === org.id}
                  onValueChange={(val) => handleAssign(org.id, val)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {gateways.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── Financial Transactions Audit Tab ───────────────────────────────

function TransactionsTab({ transactions }: { transactions: FinancialTransaction[] }) {
  return (
    <Card className="p-5 space-y-4">
      <div>
        <h2 className="text-base font-semibold">Financial Transaction Audit Ledger</h2>
        <p className="text-xs text-muted-foreground">
          Platform-wide real-time audit log of all automated recurring charges and gateway responses across organizations.
        </p>
      </div>

      {transactions.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          No financial transactions logged yet.
        </div>
      ) : (
        <div className="overflow-x-auto border rounded-md">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="p-3 font-semibold">Date</th>
                <th className="p-3 font-semibold">Organization</th>
                <th className="p-3 font-semibold">Gateway</th>
                <th className="p-3 font-semibold">Transaction ID</th>
                <th className="p-3 font-semibold">Amount</th>
                <th className="p-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {transactions.map((t) => (
                <tr key={t.id} className="hover:bg-muted/30">
                  <td className="p-3 font-mono text-muted-foreground">{t.created_at}</td>
                  <td className="p-3 font-medium">{t.org_name || `Org #${t.org_id}`}</td>
                  <td className="p-3">{t.gateway_name || t.gateway_id}</td>
                  <td className="p-3 font-mono">{t.transaction_id}</td>
                  <td className="p-3 font-semibold">LKR {t.amount.toFixed(2)}</td>
                  <td className="p-3">
                    <Badge variant={t.status === "success" ? "default" : "destructive"}>
                      {t.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
