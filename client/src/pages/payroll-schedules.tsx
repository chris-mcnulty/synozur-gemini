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
import { fmtDate } from "@/lib/payroll-format";

export default function PayrollSchedules() {
  const { data: schedules } = useQuery<any[]>({ queryKey: ["/api/payroll/schedules"] });
  const { toast } = useToast();
  const [form, setForm] = useState<any>({ name: '', frequency: 'biweekly', anchorPeriodStart: new Date().toISOString().slice(0,10), payDateOffsetDays: 5, isActive: true });
  const create = useMutation({
    mutationFn: (b: any) => apiRequest("/api/payroll/schedules", { method: "POST", body: JSON.stringify(b) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/payroll/schedules"] }); toast({ title: "Schedule created" }); },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Layout>
      <div className="p-6 space-y-6">
        <div><h1 className="text-2xl font-semibold">Pay schedules</h1>
          <p className="text-sm text-muted-foreground">Define how often payroll runs (weekly, biweekly, semi-monthly, monthly).</p></div>

        <Card>
          <CardHeader><CardTitle>Schedules</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground border-b">
                <tr><th className="py-2">Name</th><th>Frequency</th><th>Anchor period start</th><th>Pay offset</th><th>Active</th></tr>
              </thead>
              <tbody>
                {(schedules || []).map(s => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="py-2">{s.name}</td><td>{s.frequency}</td>
                    <td>{fmtDate(s.anchorPeriodStart)}</td>
                    <td>+{s.payDateOffsetDays} days</td>
                    <td>{s.isActive ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>New schedule</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-3 items-end">
              <div><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>Frequency</Label>
                <Select value={form.frequency} onValueChange={v => setForm({ ...form, frequency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="biweekly">Biweekly</SelectItem>
                    <SelectItem value="semimonthly">Semi-monthly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Anchor period start</Label><Input type="date" value={form.anchorPeriodStart} onChange={e => setForm({ ...form, anchorPeriodStart: e.target.value })} /></div>
              <div><Label>Pay date offset (days)</Label><Input type="number" value={form.payDateOffsetDays} onChange={e => setForm({ ...form, payDateOffsetDays: Number(e.target.value) })} /></div>
              <div className="col-span-4"><Button onClick={() => create.mutate(form)} disabled={create.isPending || !form.name}>Create schedule</Button></div>
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
