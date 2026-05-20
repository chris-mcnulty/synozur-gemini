import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Layout } from "@/components/layout/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtDate } from "@/lib/payroll-format";

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function MyPaystubDetail() {
  const { runId } = useParams<{ runId: string }>();
  const { data, isLoading, error } = useQuery<{ run: any; item: any; reimbursements?: Array<{ id: string; amountCents: number; category: string; description: string | null }> }>({
    queryKey: [`/api/me/payroll/paystubs/${runId}`],
  });

  if (isLoading) return <Layout><div className="p-6 text-sm text-muted-foreground">Loading…</div></Layout>;
  if (error || !data) return <Layout><div className="p-6 text-sm text-muted-foreground">Paystub not available.</div></Layout>;

  const lines = (data.item.breakdown?.lines ?? []) as Array<{ category: string; label: string; amountCents: number }>;
  const wage = lines.filter(l => l.category === 'wages');
  const preTax = lines.filter(l => l.category === 'pre_tax_deduction');
  const eeTax = lines.filter(l => l.category === 'employee_tax');
  const postTax = lines.filter(l => l.category === 'post_tax' || l.category === 'garnishment');
  const reimbursements = data.reimbursements ?? [];
  const reimbursementTotal = reimbursements.reduce((s, r) => s + r.amountCents, 0);
  const wagesNet = (data.item.netPayCents as number) - reimbursementTotal;

  return (
    <Layout>
      <div className="p-6 space-y-4 max-w-3xl">
        <div>
          <Link href="/me/paystubs"><span className="text-sm text-primary underline cursor-pointer">← all paystubs</span></Link>
          <h1 className="text-2xl font-semibold mt-1">Paystub — {fmtDate(data.run.payDate)}</h1>
          <p className="text-sm text-muted-foreground">Pay period {fmtDate(data.run.periodStart)} – {fmtDate(data.run.periodEnd)}</p>
        </div>

        <Card>
          <CardHeader><CardTitle>Earnings</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <tbody>
                {wage.map((l, i) => (<tr key={i}><td className="py-1">{l.label}</td><td className="text-right">{usd(l.amountCents)}</td></tr>))}
                <tr className="border-t font-medium"><td className="py-2">Gross</td><td className="text-right">{usd(data.item.grossCents)}</td></tr>
              </tbody>
            </table>
          </CardContent>
        </Card>

        {preTax.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Pre-tax deductions</CardTitle></CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <tbody>
                  {preTax.map((l, i) => (<tr key={i}><td className="py-1">{l.label}</td><td className="text-right">{usd(l.amountCents)}</td></tr>))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle>Taxes withheld</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <tbody>
                {eeTax.map((l, i) => (<tr key={i}><td className="py-1">{l.label}</td><td className="text-right">{usd(l.amountCents)}</td></tr>))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {postTax.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Other deductions</CardTitle></CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <tbody>
                  {postTax.map((l, i) => (<tr key={i}><td className="py-1">{l.label}</td><td className="text-right">{usd(l.amountCents)}</td></tr>))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        {reimbursements.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Reimbursements (not taxable)</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Expense reimbursements paid alongside your paycheck. Not included in your W-2 Box 1 wages.
              </p>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <tbody>
                  {reimbursements.map(r => (
                    <tr key={r.id}>
                      <td className="py-1">{r.description ?? r.category}</td>
                      <td className="text-right">{usd(r.amountCents)}</td>
                    </tr>
                  ))}
                  <tr className="border-t font-medium"><td className="py-2">Total reimbursements</td><td className="text-right">{usd(reimbursementTotal)}</td></tr>
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle>Total deposited</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{usd(data.item.netPayCents)}</div>
            {reimbursementTotal > 0 && (
              <div className="text-xs text-muted-foreground mt-2">
                = {usd(wagesNet)} wages (after tax) + {usd(reimbursementTotal)} reimbursement
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-2">Tax tables in this build are stubbed (2024 brackets, simplified) — withholding shown is an estimate. Your year-end W-2 / 1099 is the source of truth.</p>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
