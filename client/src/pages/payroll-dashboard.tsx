import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { fmtMoney, fmtDate } from "@/lib/payroll-format";
import { Users, Wallet, Receipt, Play, Landmark, FileSpreadsheet } from "lucide-react";

export default function PayrollDashboard() {
  const { data: summary } = useQuery<any>({ queryKey: ["/api/payroll/summary"] });
  const { data: runs } = useQuery<any[]>({ queryKey: ["/api/payroll/runs"] });

  return (
    <Layout>
      <div className="p-6 space-y-6" data-testid="page-payroll-dashboard">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Payroll Dashboard</h1>
            <p className="text-sm text-muted-foreground">Gemini · Workforce & Payroll</p>
          </div>
          <div className="flex gap-2">
            <Link href="/payroll/tax-settings">
              <Button variant="outline" data-testid="button-go-tax-settings"><FileSpreadsheet className="h-4 w-4 mr-2" />Tax filing settings</Button>
            </Link>
            <Link href="/payroll/jurisdictions">
              <Button variant="outline" data-testid="button-go-jurisdictions"><Landmark className="h-4 w-4 mr-2" />SUTA / Jurisdictions</Button>
            </Link>
            <Link href="/payroll/runs">
              <Button data-testid="button-go-runs"><Play className="h-4 w-4 mr-2" />Run payroll</Button>
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-normal text-muted-foreground flex items-center gap-2"><Users className="h-4 w-4" />Active employees</CardTitle></CardHeader>
            <CardContent><div className="text-3xl font-semibold" data-testid="stat-active-employees">{summary?.activeEmployees ?? 0}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-normal text-muted-foreground flex items-center gap-2"><Wallet className="h-4 w-4" />YTD gross</CardTitle></CardHeader>
            <CardContent><div className="text-3xl font-semibold">{fmtMoney(summary?.ytdGrossCents)}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-normal text-muted-foreground flex items-center gap-2"><Wallet className="h-4 w-4" />YTD net</CardTitle></CardHeader>
            <CardContent><div className="text-3xl font-semibold">{fmtMoney(summary?.ytdNetCents)}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-normal text-muted-foreground flex items-center gap-2"><Receipt className="h-4 w-4" />YTD employer tax</CardTitle></CardHeader>
            <CardContent><div className="text-3xl font-semibold">{fmtMoney(summary?.ytdEmployerTaxCents)}</div></CardContent></Card>
        </div>

        <Card>
          <CardHeader><CardTitle>Recent payroll runs</CardTitle></CardHeader>
          <CardContent>
            {!runs || runs.length === 0 ? (
              <div className="text-sm text-muted-foreground">No runs yet. Create your first payroll run.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground border-b">
                  <tr><th className="py-2">Pay date</th><th>Period</th><th>Status</th><th className="text-right">Gross</th><th className="text-right">Net</th><th></th></tr>
                </thead>
                <tbody>
                  {runs.slice(0, 8).map(r => (
                    <tr key={r.id} className="border-b last:border-0">
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
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
