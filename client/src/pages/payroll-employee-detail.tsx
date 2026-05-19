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
  const patchEmp = useMutation({
    mutationFn: (body: any) => apiRequest(`/api/payroll/employees/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/payroll/employees", id] }); toast({ title: "Updated" }); },
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

        {data.employee?.linkedUser && (
          <div className="text-xs text-muted-foreground">
            Linked internal user: <Link href={`/users?highlight=${data.employee.linkedUser.id}`}>
              <span className="text-primary underline cursor-pointer">{data.employee.linkedUser.name}</span>
            </Link>
          </div>
        )}

        <Card>
          <CardHeader><CardTitle>Tax & banking</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={(ev) => {
              ev.preventDefault();
              const fd = new FormData(ev.currentTarget);
              const num = (k: string) => {
                const v = fd.get(k); if (!v) return null;
                return Math.round(Number(v) * 100);
              };
              const body: any = {
                ssnLast4: fd.get('ssnLast4') || null,
                homeAddress: fd.get('homeAddress') || null,
                homeCity: fd.get('homeCity') || null,
                homeStateCode: (fd.get('homeStateCode') as string || '').toUpperCase() || null,
                homeZip: fd.get('homeZip') || null,
                workStateCode: (fd.get('workStateCode') as string || '').toUpperCase() || null,
                filingStatus: fd.get('filingStatus') || null,
                w4MultipleJobs: fd.get('w4MultipleJobs') === 'on',
                w4DependentsAmountCents: num('w4DependentsAmount') ?? 0,
                w4OtherIncomeCents: num('w4OtherIncome') ?? 0,
                w4DeductionsCents: num('w4Deductions') ?? 0,
                w4ExtraWithholdingCents: num('w4ExtraWithholding') ?? 0,
                bankRoutingNumber: fd.get('bankRoutingNumber') || null,
                bankAccountType: fd.get('bankAccountType') || null,
              };
              const acct = fd.get('bankAccountNumber') as string;
              // Empty means "don't change", to preserve the encrypted value.
              if (acct && acct.trim()) body.bankAccountNumberEnc = acct.trim();
              patchEmp.mutate(body);
            }}>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>SSN last 4</Label><Input name="ssnLast4" maxLength={4} defaultValue={e.ssnLast4 ?? ''} /></div>
                <div><Label>Filing status</Label>
                  <Select name="filingStatus" defaultValue={e.filingStatus ?? 'single'}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="single">Single</SelectItem>
                      <SelectItem value="married_jointly">Married filing jointly</SelectItem>
                      <SelectItem value="head_of_household">Head of household</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2"><Label>Home address</Label><Input name="homeAddress" defaultValue={e.homeAddress ?? ''} /></div>
                <div><Label>City</Label><Input name="homeCity" defaultValue={e.homeCity ?? ''} /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>State</Label><Input name="homeStateCode" maxLength={2} defaultValue={e.homeStateCode ?? ''} /></div>
                  <div><Label>ZIP</Label><Input name="homeZip" maxLength={10} defaultValue={e.homeZip ?? ''} /></div>
                </div>
                <div><Label>Work state</Label><Input name="workStateCode" maxLength={2} defaultValue={e.workStateCode ?? ''} /></div>
                <div className="flex items-end gap-2"><input type="checkbox" name="w4MultipleJobs" defaultChecked={!!e.w4MultipleJobs} className="h-4 w-4" /><Label className="text-sm">W-4 Step 2(c): multiple jobs</Label></div>
                <div><Label>W-4 dependents amount ($)</Label><Input name="w4DependentsAmount" type="number" step="0.01" defaultValue={e.w4DependentsAmountCents ? (e.w4DependentsAmountCents / 100).toFixed(2) : ''} /></div>
                <div><Label>W-4 other income ($)</Label><Input name="w4OtherIncome" type="number" step="0.01" defaultValue={e.w4OtherIncomeCents ? (e.w4OtherIncomeCents / 100).toFixed(2) : ''} /></div>
                <div><Label>W-4 deductions ($)</Label><Input name="w4Deductions" type="number" step="0.01" defaultValue={e.w4DeductionsCents ? (e.w4DeductionsCents / 100).toFixed(2) : ''} /></div>
                <div><Label>W-4 extra withholding per period ($)</Label><Input name="w4ExtraWithholding" type="number" step="0.01" defaultValue={e.w4ExtraWithholdingCents ? (e.w4ExtraWithholdingCents / 100).toFixed(2) : ''} /></div>
                <div className="col-span-2 border-t pt-3 mt-2 grid grid-cols-3 gap-3">
                  <div><Label>Bank routing #</Label><Input name="bankRoutingNumber" maxLength={9} defaultValue={e.bankRoutingNumber ?? ''} /></div>
                  <div>
                    <Label>Bank account #{e.hasBankAccount ? ' (replace)' : ''}</Label>
                    <Input name="bankAccountNumber" defaultValue="" placeholder={e.bankAccountMasked ?? 'enter to set'} />
                    {e.hasBankAccount && <p className="text-xs text-muted-foreground mt-1">On file: {e.bankAccountMasked}. Leave blank to keep.</p>}
                  </div>
                  <div><Label>Account type</Label>
                    <Select name="bankAccountType" defaultValue={e.bankAccountType ?? 'checking'}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="checking">Checking</SelectItem>
                        <SelectItem value="savings">Savings</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="col-span-3 text-xs text-muted-foreground">Account numbers are AES-256-GCM encrypted at rest when PAYROLL_ENCRYPTION_KEY is configured. The full number is never shown again after saving.</p>
                </div>
              </div>
              <div className="mt-4"><Button type="submit" disabled={patchEmp.isPending}>{patchEmp.isPending ? 'Saving…' : 'Save tax & banking'}</Button></div>
            </form>
          </CardContent>
        </Card>

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
