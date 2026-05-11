import { useState } from "react";
import { useParams, Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { fmtMoney, fmtDate } from "@/lib/payroll-format";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Trash2 } from "lucide-react";

export default function PayrollEmployeeDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<any>({ queryKey: ["/api/payroll/employees", id] });
  const [comp, setComp] = useState<any>({ compType: 'salary', amountCents: 0, effectiveFrom: new Date().toISOString().slice(0, 10) });
  const [ded, setDed] = useState<any>({ deductionType: 'pre_tax', name: '', amountCents: 0, effectiveFrom: new Date().toISOString().slice(0, 10), isActive: true });

  const addComp = useMutation({
    mutationFn: (body: any) => apiRequest(`/api/payroll/employees/${id}/compensation`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/payroll/employees", id] }); toast({ title: "Compensation added" }); },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const addDed = useMutation({
    mutationFn: (body: any) => apiRequest(`/api/payroll/employees/${id}/deductions`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/payroll/employees", id] }); toast({ title: "Deduction added" }); },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const delDed = useMutation({
    mutationFn: (dId: string) => apiRequest(`/api/payroll/deductions/${dId}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/payroll/employees", id] }),
  });

  if (isLoading || !data) return <Layout><div className="p-6">Loading…</div></Layout>;
  const e = data.employee;

  return (
    <Layout>
      <div className="p-6 space-y-6">
        <Link href="/payroll/employees"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-2" />Back</Button></Link>
        <div>
          <h1 className="text-2xl font-semibold">{e.firstName} {e.lastName}</h1>
          <p className="text-sm text-muted-foreground">{e.email} · {e.employeeType.toUpperCase()} · {e.status}</p>
        </div>

        <Card>
          <CardHeader><CardTitle>Compensation history</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground border-b">
                <tr><th className="py-2">Type</th><th>Amount</th><th>Effective</th></tr>
              </thead>
              <tbody>
                {data.compensation.map((c: any) => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="py-2">{c.compType}</td>
                    <td>{fmtMoney(c.amountCents)} {c.compType === 'salary' ? '/ year' : c.compType === 'hourly' ? '/ hr' : ''}</td>
                    <td>{fmtDate(c.effectiveFrom)} – {c.effectiveTo ? fmtDate(c.effectiveTo) : 'now'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="grid grid-cols-4 gap-3 items-end pt-3 border-t">
              <div><Label>Type</Label>
                <Select value={comp.compType} onValueChange={v => setComp({ ...comp, compType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="salary">Salary (annual)</SelectItem>
                    <SelectItem value="hourly">Hourly</SelectItem>
                    <SelectItem value="bonus">Bonus</SelectItem>
                    <SelectItem value="commission">Commission</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Amount (USD)</Label><Input type="number" step="0.01" onChange={ev => setComp({ ...comp, amountCents: Math.round(Number(ev.target.value || 0) * 100) })} /></div>
              <div><Label>Hours/wk (salary)</Label><Input type="number" step="0.5" onChange={ev => setComp({ ...comp, hoursPerWeek: ev.target.value })} /></div>
              <div><Label>Effective from</Label><Input type="date" value={comp.effectiveFrom} onChange={ev => setComp({ ...comp, effectiveFrom: ev.target.value })} /></div>
              <div className="col-span-4"><Button onClick={() => addComp.mutate(comp)} disabled={addComp.isPending}>Add compensation</Button></div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Deductions & benefits</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground border-b">
                <tr><th className="py-2">Name</th><th>Type</th><th>Amount</th><th>% of gross</th><th></th></tr>
              </thead>
              <tbody>
                {data.deductions.map((d: any) => (
                  <tr key={d.id} className="border-b last:border-0">
                    <td className="py-2">{d.name}</td>
                    <td>{d.deductionType}</td>
                    <td>{d.amountCents ? fmtMoney(d.amountCents) : '—'}</td>
                    <td>{d.percentOfGross ? `${d.percentOfGross}%` : '—'}</td>
                    <td className="text-right"><Button size="icon" variant="ghost" onClick={() => delDed.mutate(d.id)}><Trash2 className="h-4 w-4" /></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="grid grid-cols-5 gap-3 items-end pt-3 border-t">
              <div><Label>Name</Label><Input value={ded.name} onChange={ev => setDed({ ...ded, name: ev.target.value })} /></div>
              <div><Label>Type</Label>
                <Select value={ded.deductionType} onValueChange={v => setDed({ ...ded, deductionType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pre_tax">Pre-tax</SelectItem>
                    <SelectItem value="post_tax">Post-tax</SelectItem>
                    <SelectItem value="garnishment">Garnishment</SelectItem>
                    <SelectItem value="employer_match">Employer match</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Amount (USD)</Label><Input type="number" step="0.01" onChange={ev => setDed({ ...ded, amountCents: ev.target.value ? Math.round(Number(ev.target.value) * 100) : null })} /></div>
              <div><Label>% gross</Label><Input type="number" step="0.01" onChange={ev => setDed({ ...ded, percentOfGross: ev.target.value || null })} /></div>
              <div><Button onClick={() => addDed.mutate(ded)} disabled={addDed.isPending || !ded.name}>Add</Button></div>
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
