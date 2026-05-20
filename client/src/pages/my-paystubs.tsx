import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import { fmtDate } from "@/lib/payroll-format";

interface Paystub {
  runId: string;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  status: string;
  grossCents: number;
  netPayCents: number;
  employeeTaxCents: number;
  preTaxDeductionCents: number;
  postTaxDeductionCents: number;
  hoursWorked: string | null;
  overtimeHours: string | null;
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function MyPaystubs() {
  const { data, isLoading } = useQuery<{ employee: { id: string; employeeType: string; status: string } | null; paystubs: Paystub[] }>({
    queryKey: ["/api/me/payroll/paystubs"],
  });

  return (
    <Layout>
      <div className="p-6 space-y-6" data-testid="page-my-paystubs">
        <div>
          <h1 className="text-2xl font-semibold">My paystubs</h1>
          <p className="text-sm text-muted-foreground">Your finalized payroll history. Drafts and previews aren't shown.</p>
        </div>

        <Card>
          <CardHeader><CardTitle>Pay history</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : !data?.employee ? (
              <div className="text-sm text-muted-foreground">
                You aren't enrolled in payroll. Ask an admin to enroll you in the Users page.
              </div>
            ) : (data?.paystubs?.length ?? 0) === 0 ? (
              <div className="text-sm text-muted-foreground">No finalized paystubs yet.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground border-b">
                  <tr><th className="py-2">Pay date</th><th>Period</th><th>Hours</th><th className="text-right">Gross</th><th className="text-right">Taxes</th><th className="text-right">Deductions</th><th className="text-right">Net</th><th></th></tr>
                </thead>
                <tbody>
                  {data!.paystubs.map(p => (
                    <tr key={p.runId} className="border-b last:border-0" data-testid={`row-paystub-${p.runId}`}>
                      <td className="py-2">{fmtDate(p.payDate)}</td>
                      <td>{fmtDate(p.periodStart)} – {fmtDate(p.periodEnd)}</td>
                      <td>{Number(p.hoursWorked ?? 0).toFixed(2)}{Number(p.overtimeHours ?? 0) > 0 ? ` + ${Number(p.overtimeHours).toFixed(2)} OT` : ''}</td>
                      <td className="text-right">{usd(p.grossCents)}</td>
                      <td className="text-right">{usd(p.employeeTaxCents)}</td>
                      <td className="text-right">{usd(p.preTaxDeductionCents + p.postTaxDeductionCents)}</td>
                      <td className="text-right font-medium">{usd(p.netPayCents)}</td>
                      <td className="text-right">
                        <Link href={`/me/paystubs/${p.runId}`}>
                          <span className="text-primary underline cursor-pointer">open</span>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
