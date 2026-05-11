import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { fmtMoney, fmtDate } from "@/lib/payroll-format";
import { Link } from "wouter";

export default function PayrollRuns() {
  const { data: runs } = useQuery<any[]>({ queryKey: ["/api/payroll/runs"] });
  const { data: schedules } = useQuery<any[]>({ queryKey: ["/api/payroll/schedules"] });
  const { toast } = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState<any>({ payScheduleId: '', periodStart: today, periodEnd: today, payDate: today });

  const create = useMutation({
    mutationFn: (body: any) => apiRequest("/api/payroll/runs", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/runs"] });
      toast({ title: "Run created", description: "Now preview to compute payroll." });
      window.location.href = `/payroll/runs/${r.id}`;
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Layout>
      <div className="p-6 space-y-6">
        <div><h1 className="text-2xl font-semibold">Payroll runs</h1>
          <p className="text-sm text-muted-foreground">Draft → preview → approve → finalize. All runs are immutable once finalized.</p></div>

        <Card>
          <CardHeader><CardTitle>New payroll run</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-5 gap-3 items-end">
              <div className="col-span-2"><Label>Pay schedule</Label>
                <Select value={form.payScheduleId} onValueChange={v => setForm({ ...form, payScheduleId: v })}>
                  <SelectTrigger><SelectValue placeholder="Choose a schedule" /></SelectTrigger>
                  <SelectContent>
                    {(schedules || []).map(s => <SelectItem key={s.id} value={s.id}>{s.name} ({s.frequency})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Period start</Label><Input type="date" value={form.periodStart} onChange={e => setForm({ ...form, periodStart: e.target.value })} /></div>
              <div><Label>Period end</Label><Input type="date" value={form.periodEnd} onChange={e => setForm({ ...form, periodEnd: e.target.value })} /></div>
              <div><Label>Pay date</Label><Input type="date" value={form.payDate} onChange={e => setForm({ ...form, payDate: e.target.value })} /></div>
              <div className="col-span-5">
                <Button onClick={() => create.mutate(form)} disabled={create.isPending || !form.payScheduleId} data-testid="button-create-run">Create draft run</Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>All runs</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground border-b">
                <tr><th className="py-2">Pay date</th><th>Period</th><th>Status</th><th className="text-right">Gross</th><th className="text-right">Net</th><th></th></tr>
              </thead>
              <tbody>
                {(runs || []).map(r => (
                  <tr key={r.id} className="border-b last:border-0" data-testid={`row-run-${r.id}`}>
                    <td className="py-2">{fmtDate(r.payDate)}</td>
                    <td>{fmtDate(r.periodStart)} – {fmtDate(r.periodEnd)}</td>
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
