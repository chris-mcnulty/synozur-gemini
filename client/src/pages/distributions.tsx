import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { fmtMoney, fmtDate } from "@/lib/payroll-format";
import { Link } from "wouter";
import { Trash2, UserPlus } from "lucide-react";

function currentQuarterLabel(): string {
  const d = new Date();
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${d.getUTCFullYear()}-Q${q}`;
}

function quarterOptions(): string[] {
  const out: string[] = [];
  const now = new Date();
  // 8 quarters back through current
  for (let i = 8; i >= 0; i--) {
    const ref = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i * 3, 1));
    const q = Math.floor(ref.getUTCMonth() / 3) + 1;
    const lbl = `${ref.getUTCFullYear()}-Q${q}`;
    if (!out.includes(lbl)) out.push(lbl);
  }
  return out.reverse();
}

export default function Distributions() {
  const { toast } = useToast();
  const { data: runs } = useQuery<any[]>({ queryKey: ["/api/distributions/runs"] });
  const { data: owners } = useQuery<any[]>({ queryKey: ["/api/distributions/owners"] });
  const { data: policy } = useQuery<any>({ queryKey: ["/api/distributions/policy"] });
  const { data: users } = useQuery<any[]>({ queryKey: ["/api/users"] });

  const [quarter, setQuarter] = useState<string>(currentQuarterLabel());

  const createRun = useMutation({
    mutationFn: (body: any) => apiRequest("/api/distributions/runs", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/distributions/runs"] });
      toast({ title: "Run created", description: "Click Preview on the run page to compute funds + lines." });
      window.location.href = `/distributions/runs/${r.id}`;
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Layout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Quarterly distributions</h1>
          <p className="text-sm text-muted-foreground">
            Owner distributions and FTE profit-sharing pool. Draft → preview → approve → finalize. See{" "}
            <a className="underline" href="/docs/USER_GUIDE.md" target="_blank" rel="noopener">docs</a>.
          </p>
        </div>

        <Tabs defaultValue="runs" className="space-y-4">
          <TabsList>
            <TabsTrigger value="runs" data-testid="tab-runs">Runs</TabsTrigger>
            <TabsTrigger value="owners" data-testid="tab-owners">Owners</TabsTrigger>
            <TabsTrigger value="policy" data-testid="tab-policy">Policy</TabsTrigger>
          </TabsList>

          <TabsContent value="runs" className="space-y-4">
            <Card>
              <CardHeader><CardTitle>New distribution run</CardTitle></CardHeader>
              <CardContent>
                <div className="flex gap-3 items-end">
                  <div className="flex-1 max-w-xs">
                    <Label>Quarter</Label>
                    <Select value={quarter} onValueChange={setQuarter}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {quarterOptions().map(q => <SelectItem key={q} value={q}>{q}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    onClick={() => createRun.mutate({ quarterLabel: quarter })}
                    disabled={createRun.isPending}
                    data-testid="button-create-run"
                  >
                    Create draft run
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>All runs</CardTitle></CardHeader>
              <CardContent>
                {(!runs || runs.length === 0) ? (
                  <div className="text-sm text-muted-foreground">No runs yet. Create one above.</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="text-left text-muted-foreground border-b">
                      <tr>
                        <th className="py-2">Quarter</th>
                        <th>Period</th>
                        <th>Status</th>
                        <th className="text-right">Available</th>
                        <th className="text-right">Owner pool</th>
                        <th className="text-right">FTE pool</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map(r => (
                        <tr key={r.id} className="border-b last:border-0" data-testid={`row-run-${r.id}`}>
                          <td className="py-2 font-medium">{r.quarterLabel}</td>
                          <td>{fmtDate(r.periodStart)} – {fmtDate(r.periodEnd)}</td>
                          <td>
                            <span className={
                              "px-2 py-0.5 text-xs rounded " +
                              (r.status === 'finalized' ? 'bg-green-100 text-green-900'
                                : r.status === 'reversed' ? 'bg-red-100 text-red-900'
                                : 'bg-accent')
                            }>
                              {r.status}
                            </span>
                          </td>
                          <td className="text-right">{fmtMoney(r.availableFundsCents)}</td>
                          <td className="text-right">{fmtMoney(r.ownerPoolCents)}</td>
                          <td className="text-right">{fmtMoney(r.ftePoolCents)}</td>
                          <td className="text-right">
                            <Link href={`/distributions/runs/${r.id}`}>
                              <Button variant="link" size="sm">Open</Button>
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="owners" className="space-y-4">
            <OwnersPanel owners={owners ?? []} users={users ?? []} />
          </TabsContent>

          <TabsContent value="policy" className="space-y-4">
            <PolicyPanel policy={policy} />
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}

// -------- Owners panel ------------------------------------------------------

function OwnersPanel({ owners, users }: { owners: any[]; users: any[] }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    userId: "",
    ownershipPct: "50.0000",
    effectiveFrom: new Date().toISOString().slice(0, 10),
    distributionMethod: "k1",
    bankRoutingNumber: "",
    bankAccountNumber: "",
    bankAccountType: "checking",
  });

  const create = useMutation({
    mutationFn: (body: any) => apiRequest("/api/distributions/owners", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/distributions/owners"] });
      toast({ title: "Owner added" });
      setForm({ ...form, userId: "", ownershipPct: "0.0000", bankRoutingNumber: "", bankAccountNumber: "" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const retire = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/distributions/owners/${id}/retire`, {
      method: "POST",
      body: JSON.stringify({ effectiveTo: new Date().toISOString().slice(0, 10) }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/distributions/owners"] });
      toast({ title: "Owner retired" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const totalPct = owners.filter(o => !o.effectiveTo).reduce((s, o) => s + Number(o.ownershipPct), 0);

  return (
    <>
      <Card>
        <CardHeader><CardTitle>Add owner</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label>User</Label>
              <Select value={form.userId} onValueChange={v => setForm({ ...form, userId: v })}>
                <SelectTrigger><SelectValue placeholder="Choose a user" /></SelectTrigger>
                <SelectContent>
                  {users.map(u => <SelectItem key={u.id} value={u.id}>{u.name ?? u.email}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Ownership %</Label>
              <Input
                value={form.ownershipPct}
                onChange={e => setForm({ ...form, ownershipPct: e.target.value })}
                placeholder="50.0000"
                data-testid="input-ownership-pct"
              />
            </div>
            <div>
              <Label>Effective from</Label>
              <Input type="date" value={form.effectiveFrom} onChange={e => setForm({ ...form, effectiveFrom: e.target.value })} />
            </div>
            <div>
              <Label>Distribution method</Label>
              <Select value={form.distributionMethod} onValueChange={v => setForm({ ...form, distributionMethod: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="k1">K-1 (LLC partnership)</SelectItem>
                  <SelectItem value="w2_bonus">W-2 bonus (S-corp reasonable comp)</SelectItem>
                  <SelectItem value="1099_div">1099-DIV (C-corp)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Bank routing</Label>
              <Input value={form.bankRoutingNumber} onChange={e => setForm({ ...form, bankRoutingNumber: e.target.value })} placeholder="9 digits" maxLength={9} />
            </div>
            <div>
              <Label>Bank account #</Label>
              <Input value={form.bankAccountNumber} onChange={e => setForm({ ...form, bankAccountNumber: e.target.value })} placeholder="encrypted at rest" />
            </div>
            <div>
              <Label>Account type</Label>
              <Select value={form.bankAccountType} onValueChange={v => setForm({ ...form, bankAccountType: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="checking">Checking</SelectItem>
                  <SelectItem value="savings">Savings</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-3">
              <Button
                onClick={() => create.mutate(form)}
                disabled={create.isPending || !form.userId}
                data-testid="button-add-owner"
              >
                <UserPlus className="h-4 w-4 mr-2" />Add owner
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Owners</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Active ownership sums to <strong>{totalPct.toFixed(4)}%</strong>
            {Math.abs(totalPct - 100) > 0.01 && (
              <span className="ml-2 text-amber-700">
                — should total 100% before previewing a run
              </span>
            )}
          </p>
        </CardHeader>
        <CardContent>
          {owners.length === 0 ? (
            <div className="text-sm text-muted-foreground">No owners yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground border-b">
                <tr>
                  <th className="py-2">Name</th>
                  <th>Method</th>
                  <th className="text-right">Ownership %</th>
                  <th>Effective from</th>
                  <th>Effective to</th>
                  <th>Bank on file?</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {owners.map(o => (
                  <tr key={o.id} className="border-b last:border-0" data-testid={`row-owner-${o.id}`}>
                    <td className="py-2 font-medium">{o.user?.name ?? o.user?.email ?? o.userId}</td>
                    <td><span className="px-2 py-0.5 text-xs rounded bg-accent">{o.distributionMethod}</span></td>
                    <td className="text-right">{Number(o.ownershipPct).toFixed(4)}%</td>
                    <td>{fmtDate(o.effectiveFrom)}</td>
                    <td>{o.effectiveTo ? fmtDate(o.effectiveTo) : <span className="text-green-700">active</span>}</td>
                    <td>{o.bankAccountNumberEnc ? "Yes" : <span className="text-amber-700">No</span>}</td>
                    <td className="text-right">
                      {!o.effectiveTo && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => retire.mutate(o.id)}
                          disabled={retire.isPending}
                          data-testid={`button-retire-${o.id}`}
                        >
                          <Trash2 className="h-3 w-3 mr-1" />Retire
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

// -------- Policy panel ------------------------------------------------------

function PolicyPanel({ policy }: { policy: any }) {
  const { toast } = useToast();
  const [form, setForm] = useState<any>({
    ownerPoolPct: policy?.ownerPoolPct ?? "70.0000",
    ftePoolPct: policy?.ftePoolPct ?? "30.0000",
    taxReservePct: policy?.taxReservePct ?? "25.0000",
    operatingReserveMonths: policy?.operatingReserveMonths ?? "3.00",
    waBoRatePct: policy?.waBoRatePct ?? "0.0000",
    weightSalary: policy?.fteWeights?.salary ?? 60,
    weightTenure: policy?.fteWeights?.tenure ?? 10,
    weightPerformance: policy?.fteWeights?.performance ?? 20,
    weightHours: policy?.fteWeights?.hours ?? 10,
  });

  // Refresh form when policy loads/changes. Keyed on the policy id so we
  // only reset on a real change, not every re-render.
  useEffect(() => {
    if (!policy) return;
    setForm({
      ownerPoolPct: policy.ownerPoolPct,
      ftePoolPct: policy.ftePoolPct,
      taxReservePct: policy.taxReservePct,
      operatingReserveMonths: policy.operatingReserveMonths,
      waBoRatePct: policy.waBoRatePct,
      weightSalary: policy.fteWeights?.salary ?? 60,
      weightTenure: policy.fteWeights?.tenure ?? 10,
      weightPerformance: policy.fteWeights?.performance ?? 20,
      weightHours: policy.fteWeights?.hours ?? 10,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policy?.id, policy?.updatedAt]);

  const save = useMutation({
    mutationFn: () => apiRequest("/api/distributions/policy", {
      method: "PATCH",
      body: JSON.stringify({
        ownerPoolPct: form.ownerPoolPct,
        ftePoolPct: form.ftePoolPct,
        taxReservePct: form.taxReservePct,
        operatingReserveMonths: form.operatingReserveMonths,
        waBoRatePct: form.waBoRatePct,
        fteWeights: {
          salary: Number(form.weightSalary),
          tenure: Number(form.weightTenure),
          performance: Number(form.weightPerformance),
          hours: Number(form.weightHours),
        },
      }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/distributions/policy"] });
      toast({ title: "Policy saved" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const poolSum = Number(form.ownerPoolPct) + Number(form.ftePoolPct);
  const weightSum = Number(form.weightSalary) + Number(form.weightTenure) + Number(form.weightPerformance) + Number(form.weightHours);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Distribution policy</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Defaults applied to every preview. Each run captures a snapshot at preview time, so changing these doesn't rewrite history.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <h3 className="text-sm font-semibold mb-3">Pool split</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Owner pool %</Label>
              <Input value={form.ownerPoolPct} onChange={e => setForm({ ...form, ownerPoolPct: e.target.value })} data-testid="input-owner-pct" />
            </div>
            <div>
              <Label>FTE pool %</Label>
              <Input value={form.ftePoolPct} onChange={e => setForm({ ...form, ftePoolPct: e.target.value })} data-testid="input-fte-pct" />
            </div>
          </div>
          <p className={"text-xs mt-1 " + (Math.abs(poolSum - 100) > 0.01 ? "text-amber-700" : "text-muted-foreground")}>
            Sum: {poolSum.toFixed(2)}% {Math.abs(poolSum - 100) > 0.01 && "(should total 100%)"}
          </p>
        </div>

        <div>
          <h3 className="text-sm font-semibold mb-3">Reserves carved out before pool math</h3>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Tax reserve % of revenue</Label>
              <Input value={form.taxReservePct} onChange={e => setForm({ ...form, taxReservePct: e.target.value })} />
            </div>
            <div>
              <Label>Operating reserve (months)</Label>
              <Input value={form.operatingReserveMonths} onChange={e => setForm({ ...form, operatingReserveMonths: e.target.value })} />
            </div>
            <div>
              <Label>WA B&amp;O accrual %</Label>
              <Input value={form.waBoRatePct} onChange={e => setForm({ ...form, waBoRatePct: e.target.value })} />
              <p className="text-xs text-muted-foreground mt-1">1.5 for WA services tenants; 0 elsewhere.</p>
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold mb-3">FTE pool weights</h3>
          <p className="text-xs text-muted-foreground mb-3">
            Each candidate's score is the normalized factor × weight, then summed. Weights don't need to total 100 — they're relative.
          </p>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <Label>Salary</Label>
              <Input value={form.weightSalary} onChange={e => setForm({ ...form, weightSalary: e.target.value })} data-testid="input-weight-salary" />
            </div>
            <div>
              <Label>Tenure</Label>
              <Input value={form.weightTenure} onChange={e => setForm({ ...form, weightTenure: e.target.value })} />
            </div>
            <div>
              <Label>Performance</Label>
              <Input value={form.weightPerformance} onChange={e => setForm({ ...form, weightPerformance: e.target.value })} />
            </div>
            <div>
              <Label>Hours</Label>
              <Input value={form.weightHours} onChange={e => setForm({ ...form, weightHours: e.target.value })} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Sum: {weightSum} (relative weights)</p>
        </div>

        <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-policy">
          Save policy
        </Button>
      </CardContent>
    </Card>
  );
}
