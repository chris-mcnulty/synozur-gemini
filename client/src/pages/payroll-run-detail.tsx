import { useParams, Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { fmtMoney, fmtDate } from "@/lib/payroll-format";
import { ArrowLeft, Download } from "lucide-react";

export default function PayrollRunDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<any>({ queryKey: ["/api/payroll/runs", id] });
  const { data: employees } = useQuery<any[]>({ queryKey: ["/api/payroll/employees"] });
  const empMap = new Map((employees || []).map(e => [e.id, e]));

  const preview = useMutation({
    mutationFn: () => apiRequest(`/api/payroll/runs/${id}/preview`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/payroll/runs", id] }); toast({ title: "Preview computed" }); },
    onError: (e: any) => toast({ title: "Preview failed", description: e.message, variant: "destructive" }),
  });
  const approve = useMutation({
    mutationFn: () => apiRequest(`/api/payroll/runs/${id}/approve`, { method: "POST" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/payroll/runs", id] }); toast({ title: "Approved" }); },
    onError: (e: any) => toast({ title: "Approve failed", description: e.message, variant: "destructive" }),
  });
  const finalize = useMutation({
    mutationFn: () => apiRequest(`/api/payroll/runs/${id}/finalize`, { method: "POST" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/payroll/runs", id] }); toast({ title: "Finalized" }); },
    onError: (e: any) => toast({ title: "Finalize failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !data) return <Layout><div className="p-6">Loading…</div></Layout>;
  const r = data.run;
  const items = data.items as any[];
  const reimbursements = (data.reimbursements ?? []) as Array<{
    id: string; employeeId: string; employeeName: string; expenseId: string;
    amountCents: number; category: string; description: string | null;
  }>;
  const reimbursementTotal = reimbursements.reduce((s, x) => s + x.amountCents, 0);

  return (
    <Layout>
      <div className="p-6 space-y-6">
        <Link href="/payroll/runs"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-2" />Back</Button></Link>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Payroll run · {fmtDate(r.payDate)}</h1>
            <p className="text-sm text-muted-foreground">Period {fmtDate(r.periodStart)} – {fmtDate(r.periodEnd)} · status {r.status}</p>
          </div>
          <div className="flex gap-2">
            {r.status !== 'finalized' && r.status !== 'voided' && (
              <Button variant="outline" onClick={() => preview.mutate()} disabled={preview.isPending} data-testid="button-preview">Preview</Button>
            )}
            {r.status === 'previewed' && <Button onClick={() => approve.mutate()} disabled={approve.isPending} data-testid="button-approve">Approve</Button>}
            {r.status === 'approved' && <Button onClick={() => finalize.mutate()} disabled={finalize.isPending} data-testid="button-finalize">Finalize</Button>}
            <a href={`/api/payroll/runs/${id}/gl-export?format=csv`}><Button variant="outline"><Download className="h-4 w-4 mr-2" />GL CSV</Button></a>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Gross</CardTitle></CardHeader><CardContent><div className="text-xl font-semibold">{fmtMoney(r.totalGrossCents)}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Employee tax</CardTitle></CardHeader><CardContent><div className="text-xl font-semibold">{fmtMoney(r.totalEmployeeTaxCents)}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Employer tax</CardTitle></CardHeader><CardContent><div className="text-xl font-semibold">{fmtMoney(r.totalEmployerTaxCents)}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Deductions</CardTitle></CardHeader><CardContent><div className="text-xl font-semibold">{fmtMoney(r.totalDeductionsCents)}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Net pay</CardTitle></CardHeader><CardContent><div className="text-xl font-semibold">{fmtMoney(r.totalNetCents)}</div></CardContent></Card>
        </div>

        {reimbursements.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Expense reimbursements bundled into this run</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Constellation-approved reimbursable expenses paid through payroll (accountable plan — not taxable). Total {fmtMoney(reimbursementTotal)} across {reimbursements.length} {reimbursements.length === 1 ? 'expense' : 'expenses'}.
              </p>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground border-b">
                  <tr><th className="py-2">Employee</th><th>Category</th><th>Description</th><th className="text-right">Amount</th></tr>
                </thead>
                <tbody>
                  {reimbursements.map(rb => (
                    <tr key={rb.id} className="border-b last:border-0" data-testid={`row-reimbursement-${rb.id}`}>
                      <td className="py-2">{rb.employeeName}</td>
                      <td><span className="px-2 py-0.5 text-xs rounded bg-accent">{rb.category}</span></td>
                      <td className="text-muted-foreground">{rb.description ?? '—'}</td>
                      <td className="text-right font-medium">{fmtMoney(rb.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle>Per-employee breakdown</CardTitle></CardHeader>
          <CardContent>
            {items.length === 0 ? <div className="text-sm text-muted-foreground">No items yet — click Preview to compute.</div> : (
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground border-b">
                  <tr><th className="py-2">Employee</th><th className="text-right">Gross</th><th className="text-right">Pre-tax ded.</th><th className="text-right">Emp tax</th><th className="text-right">Empr tax</th><th className="text-right">Post-tax ded.</th><th className="text-right">Net</th></tr>
                </thead>
                <tbody>
                  {items.map(it => {
                    const emp = empMap.get(it.employeeId);
                    return (
                      <tr key={it.id} className="border-b last:border-0">
                        <td className="py-2">{emp ? `${emp.firstName} ${emp.lastName}` : it.employeeId}</td>
                        <td className="text-right">{fmtMoney(it.grossCents)}</td>
                        <td className="text-right">{fmtMoney(it.preTaxDeductionCents)}</td>
                        <td className="text-right">{fmtMoney(it.employeeTaxCents)}</td>
                        <td className="text-right">{fmtMoney(it.employerTaxCents)}</td>
                        <td className="text-right">{fmtMoney(it.postTaxDeductionCents)}</td>
                        <td className="text-right font-medium">{fmtMoney(it.netPayCents)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
