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

const CATEGORIES = [
  { value: 'wages', label: 'Wages expense' },
  { value: 'employer_tax', label: 'Employer tax expense' },
  { value: 'employee_tax_liability', label: 'Employee tax liability' },
  { value: 'employer_tax_liability', label: 'Employer tax liability' },
  { value: 'pre_tax_deduction', label: 'Pre-tax deduction liability' },
  { value: 'post_tax_deduction', label: 'Post-tax deduction liability' },
  { value: 'garnishment_liability', label: 'Garnishment liability' },
  { value: 'net_pay_clearing', label: 'Net pay clearing' },
];

export default function PayrollGl() {
  const { data: accounts } = useQuery<any[]>({ queryKey: ["/api/payroll/gl-accounts"] });
  const { data: mappings } = useQuery<any[]>({ queryKey: ["/api/payroll/gl-mappings"] });
  const { toast } = useToast();
  const [acct, setAcct] = useState<any>({ accountNumber: '', accountName: '', accountType: 'expense' });

  const createAcct = useMutation({
    mutationFn: (b: any) => apiRequest("/api/payroll/gl-accounts", { method: "POST", body: JSON.stringify(b) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/payroll/gl-accounts"] }); toast({ title: "Account created" }); setAcct({ accountNumber: '', accountName: '', accountType: 'expense' }); },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const setMapping = useMutation({
    mutationFn: (b: any) => apiRequest("/api/payroll/gl-mappings", { method: "POST", body: JSON.stringify(b) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/payroll/gl-mappings"] }); toast({ title: "Mapping saved" }); },
  });

  const mapBy = new Map((mappings || []).map((m: any) => [m.category, m]));

  return (
    <Layout>
      <div className="p-6 space-y-6">
        <div><h1 className="text-2xl font-semibold">General Ledger</h1>
          <p className="text-sm text-muted-foreground">Map payroll categories to your chart of accounts. Used by the GL export on each payroll run.</p></div>

        <Card>
          <CardHeader><CardTitle>Chart of accounts</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground border-b">
                <tr><th className="py-2">Account #</th><th>Name</th><th>Type</th></tr>
              </thead>
              <tbody>
                {(accounts || []).map(a => (<tr key={a.id} className="border-b last:border-0"><td className="py-2">{a.accountNumber}</td><td>{a.accountName}</td><td>{a.accountType}</td></tr>))}
              </tbody>
            </table>
            <div className="grid grid-cols-4 gap-3 items-end pt-3 border-t">
              <div><Label>Account #</Label><Input value={acct.accountNumber} onChange={e => setAcct({ ...acct, accountNumber: e.target.value })} /></div>
              <div><Label>Name</Label><Input value={acct.accountName} onChange={e => setAcct({ ...acct, accountName: e.target.value })} /></div>
              <div><Label>Type</Label>
                <Select value={acct.accountType} onValueChange={v => setAcct({ ...acct, accountType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="expense">Expense</SelectItem>
                    <SelectItem value="liability">Liability</SelectItem>
                    <SelectItem value="asset">Asset</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Button onClick={() => createAcct.mutate(acct)} disabled={createAcct.isPending || !acct.accountNumber}>Add account</Button></div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Category mappings</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground border-b">
                <tr><th className="py-2">Category</th><th>GL account</th></tr>
              </thead>
              <tbody>
                {CATEGORIES.map(c => (
                  <tr key={c.value} className="border-b last:border-0">
                    <td className="py-2">{c.label}</td>
                    <td>
                      <Select
                        value={(mapBy.get(c.value) as any)?.glAccountId || ''}
                        onValueChange={v => setMapping.mutate({ category: c.value, glAccountId: v })}>
                        <SelectTrigger className="w-80"><SelectValue placeholder="Pick an account" /></SelectTrigger>
                        <SelectContent>
                          {(accounts || []).map((a: any) => <SelectItem key={a.id} value={a.id}>{a.accountNumber} — {a.accountName}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
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
