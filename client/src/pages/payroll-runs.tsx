import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { fmtMoney, fmtDate } from "@/lib/payroll-format";
import { Link } from "wouter";

type RunType = 'regular' | 'bonus';

export default function PayrollRuns() {
  const { data: runs } = useQuery<any[]>({ queryKey: ["/api/payroll/runs"] });
  const { data: schedules } = useQuery<any[]>({ queryKey: ["/api/payroll/schedules"] });
  const { data: employees } = useQuery<any[]>({ queryKey: ["/api/payroll/employees"] });
  const { toast } = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState<{
    runType: RunType;
    payScheduleId: string;
    periodStart: string;
    periodEnd: string;
    payDate: string;
    targetEmployeeIds: string[];
  }>({
    runType: 'regular',
    payScheduleId: '',
    periodStart: today,
    periodEnd: today,
    payDate: today,
    targetEmployeeIds: [],
  });

  const create = useMutation({
    mutationFn: (body: any) => apiRequest("/api/payroll/runs", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/runs"] });
      toast({ title: "Run created", description: "Now preview to compute payroll." });
      window.location.href = `/payroll/runs/${r.id}`;
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const isBonus = form.runType === 'bonus';
  const eligibleEmployees = (employees || []).filter((e: any) => e.status !== 'terminated' && e.employeeType === 'w2');
  const toggleEmployee = (id: string) => {
    setForm(f => f.targetEmployeeIds.includes(id)
      ? { ...f, targetEmployeeIds: f.targetEmployeeIds.filter(x => x !== id) }
      : { ...f, targetEmployeeIds: [...f.targetEmployeeIds, id] });
  };

  const submit = () => {
    const body: any = {
      payScheduleId: form.payScheduleId,
      periodStart: form.periodStart,
      periodEnd: form.periodEnd,
      payDate: form.payDate,
      runType: form.runType,
    };
    if (isBonus) {
      if (form.targetEmployeeIds.length === 0) {
        toast({ title: "Pick at least one employee", description: "A bonus run requires selecting employees.", variant: "destructive" });
        return;
      }
      body.targetEmployeeIds = form.targetEmployeeIds;
    }
    create.mutate(body);
  };

  const canSubmit = !!form.payScheduleId && (!isBonus || form.targetEmployeeIds.length > 0);

  return (
    <Layout>
      <div className="p-6 space-y-6">
        <div><h1 className="text-2xl font-semibold">Payroll runs</h1>
          <p className="text-sm text-muted-foreground">Draft → preview → approve → finalize. All runs are immutable once finalized.</p></div>

        <Card>
          <CardHeader><CardTitle>New payroll run</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-6 gap-3 items-end">
              <div><Label>Run type</Label>
                <Select value={form.runType} onValueChange={v => setForm({ ...form, runType: v as RunType, targetEmployeeIds: [] })}>
                  <SelectTrigger data-testid="select-run-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="regular">Regular</SelectItem>
                    <SelectItem value="bonus">Bonus / off-cycle</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2"><Label>Pay schedule</Label>
                <Select value={form.payScheduleId} onValueChange={v => setForm({ ...form, payScheduleId: v })}>
                  <SelectTrigger data-testid="select-pay-schedule"><SelectValue placeholder="Choose a schedule" /></SelectTrigger>
                  <SelectContent>
                    {(schedules || []).map(s => <SelectItem key={s.id} value={s.id}>{s.name} ({s.frequency})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Period start</Label><Input type="date" value={form.periodStart} onChange={e => setForm({ ...form, periodStart: e.target.value })} /></div>
              <div><Label>Period end</Label><Input type="date" value={form.periodEnd} onChange={e => setForm({ ...form, periodEnd: e.target.value })} /></div>
              <div><Label>Pay date</Label><Input type="date" value={form.payDate} onChange={e => setForm({ ...form, payDate: e.target.value })} /></div>

              {isBonus && (
                <div className="col-span-6 border-t pt-4 mt-2">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <Label className="text-base">Employees to pay</Label>
                      <p className="text-xs text-muted-foreground">A bonus run only pays the people you pick. Pay-schedule filter is bypassed.</p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setForm(f => ({ ...f, targetEmployeeIds: eligibleEmployees.map((e: any) => e.id) }))}>Select all</Button>
                      <Button variant="outline" size="sm" onClick={() => setForm(f => ({ ...f, targetEmployeeIds: [] }))}>Clear</Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-72 overflow-y-auto pr-2">
                    {eligibleEmployees.map((e: any) => (
                      <label key={e.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-accent rounded px-2 py-1" data-testid={`row-bonus-emp-${e.id}`}>
                        <Checkbox checked={form.targetEmployeeIds.includes(e.id)} onCheckedChange={() => toggleEmployee(e.id)} />
                        <span className="truncate">{e.firstName} {e.lastName}</span>
                        <span className="text-xs text-muted-foreground ml-auto">{e.status}</span>
                      </label>
                    ))}
                    {eligibleEmployees.length === 0 && <p className="text-sm text-muted-foreground col-span-3">No eligible W-2 employees.</p>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">{form.targetEmployeeIds.length} of {eligibleEmployees.length} selected</p>
                </div>
              )}

              <div className="col-span-6">
                <Button onClick={submit} disabled={create.isPending || !canSubmit} data-testid="button-create-run">
                  {isBonus ? `Create bonus run (${form.targetEmployeeIds.length})` : 'Create draft run'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>All runs</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground border-b">
                <tr><th className="py-2">Pay date</th><th>Period</th><th>Type</th><th>Status</th><th className="text-right">Gross</th><th className="text-right">Net</th><th></th></tr>
              </thead>
              <tbody>
                {(runs || []).map(r => (
                  <tr key={r.id} className="border-b last:border-0" data-testid={`row-run-${r.id}`}>
                    <td className="py-2">{fmtDate(r.payDate)}</td>
                    <td>{fmtDate(r.periodStart)} – {fmtDate(r.periodEnd)}</td>
                    <td><span className={`px-2 py-0.5 text-xs rounded ${r.runType === 'bonus' ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100' : r.runType === 'reversal' ? 'bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100' : 'bg-accent'}`}>{r.runType ?? 'regular'}</span></td>
                    <td><span className="px-2 py-0.5 text-xs rounded bg-accent">{r.status}</span></td>
                    <td className="text-right">{fmtMoney(r.totalGrossCents)}</td>
                    <td className="text-right">{fmtMoney(r.totalNetCents)}</td>
                    <td className="text-right"><Link href={`/payroll/runs/${r.id}`}><Button variant="link" size="sm">Open</Button></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
