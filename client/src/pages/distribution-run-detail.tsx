import { useParams, Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { fmtMoney, fmtDate } from "@/lib/payroll-format";
import { ArrowLeft, Download, AlertTriangle, ArrowRight } from "lucide-react";
import { useState } from "react";

export default function DistributionRunDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<any>({ queryKey: ["/api/distributions/runs", id] });
  // ftePayrollRunId is the only piece of finalize-response state that's not
  // already on the run record itself. Warnings come from `run.warnings`
  // (persisted in the DB) so they survive a refresh and remain visible
  // once the run advances past 'previewed'.
  const [ftePayrollRunId, setFtePayrollRunId] = useState<string | null>(null);
  const [achReady, setAchReady] = useState<boolean>(false);

  const preview = useMutation({
    mutationFn: () => apiRequest(`/api/distributions/runs/${id}/preview`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/distributions/runs", id] });
      toast({ title: "Preview computed" });
    },
    onError: (e: any) => toast({ title: "Preview failed", description: e.message, variant: "destructive" }),
  });

  const approve = useMutation({
    mutationFn: () => apiRequest(`/api/distributions/runs/${id}/approve`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/distributions/runs", id] });
      toast({ title: "Approved", description: "Ready to finalize." });
    },
    onError: (e: any) => toast({ title: "Approve failed", description: e.message, variant: "destructive" }),
  });

  const finalize = useMutation({
    mutationFn: () => apiRequest(`/api/distributions/runs/${id}/finalize`, { method: "POST" }),
    onSuccess: (resp: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/distributions/runs", id] });
      setFtePayrollRunId(resp?.ftePayrollRunId ?? null);
      setAchReady(Boolean(resp?.ownerAchAvailable));
      toast({
        title: "Finalized",
        description: resp?.message ?? "Owner ACH file ready; FTE payroll run created in draft.",
      });
    },
    onError: (e: any) => toast({ title: "Finalize failed", description: e.message, variant: "destructive" }),
  });

  const reverse = useMutation({
    mutationFn: () => apiRequest(`/api/distributions/runs/${id}/reverse`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/distributions/runs", id] });
      toast({ title: "Run reversed" });
    },
    onError: (e: any) => toast({ title: "Reverse failed", description: e.message, variant: "destructive" }),
  });

  // Stream the owner NACHA file as a download. The server returns
  // text/plain attachment so the file content never enters a JSON
  // payload (where plaintext routing/account numbers could leak through
  // logs, devtools history, or gateway caches).
  function downloadAchFile() {
    window.location.href = `/api/distributions/runs/${id}/owner-ach`;
  }

  if (isLoading || !data) return <Layout><div className="p-6">Loading…</div></Layout>;

  const r = data.run;
  // Warnings come from the persisted run record so they survive
  // refreshes and remain visible after preview → approved → finalized.
  const warnings: string[] = Array.isArray(r.warnings) ? r.warnings : [];
  // Owner ACH download is available once the run is finalized (and was
  // also reported as available by the most recent finalize call).
  const ownerAchAvailable = r.status === 'finalized' && (achReady || !!r.nachaEffectiveDate);
  const lines = (data.lines ?? []) as any[];
  const ownerLines = lines.filter(l => l.recipientType === 'owner');
  const fteLines = lines.filter(l => l.recipientType === 'fte');

  return (
    <Layout>
      <div className="p-6 space-y-6">
        <Link href="/distributions"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-2" />Back</Button></Link>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Distribution · {r.quarterLabel}</h1>
            <p className="text-sm text-muted-foreground">
              Period {fmtDate(r.periodStart)} – {fmtDate(r.periodEnd)} · status <strong>{r.status}</strong>
            </p>
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            {(r.status === 'draft' || r.status === 'previewed') && (
              <Button variant="outline" onClick={() => preview.mutate()} disabled={preview.isPending} data-testid="button-preview">
                {r.status === 'previewed' ? 'Re-preview' : 'Preview'}
              </Button>
            )}
            {r.status === 'previewed' && (
              <Button onClick={() => approve.mutate()} disabled={approve.isPending} data-testid="button-approve">
                Approve
              </Button>
            )}
            {r.status === 'approved' && (
              <Button onClick={() => finalize.mutate()} disabled={finalize.isPending} data-testid="button-finalize">
                Finalize
              </Button>
            )}
            {r.status === 'finalized' && (
              <Button variant="destructive" onClick={() => {
                if (confirm('Reverse this finalized run? The FTE bonus payroll run is NOT auto-reversed.')) {
                  reverse.mutate();
                }
              }} data-testid="button-reverse">
                Reverse
              </Button>
            )}
          </div>
        </div>

        {warnings.length > 0 && (
          <Card className="border-amber-300">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-amber-800">
                <AlertTriangle className="h-4 w-4" />Preview warnings
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="text-sm text-amber-900 list-disc pl-5 space-y-1">
                {warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </CardContent>
          </Card>
        )}

        {ownerAchAvailable && (
          <Card className="border-green-300">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-green-800">Owner ACH file ready</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between">
              <p className="text-sm">Upload this to your bank's ACH origination portal.</p>
              <Button onClick={downloadAchFile} data-testid="button-download-ach">
                <Download className="h-4 w-4 mr-2" />Download NACHA file
              </Button>
            </CardContent>
          </Card>
        )}

        {ftePayrollRunId && (
          <Card className="border-blue-300">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-blue-900">FTE bonus payroll run created</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between">
              <p className="text-sm">
                A draft <code>bonus</code> payroll run holds the FTE pool. Preview and finalize it through the payroll workflow so taxes + ACH go through the regular pipeline.
              </p>
              <Link href={`/payroll/runs/${ftePayrollRunId}`}>
                <Button data-testid="button-open-fte-run">
                  Open payroll run<ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}

        {/* Available funds breakdown */}
        <Card>
          <CardHeader><CardTitle>Available funds breakdown</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <tbody>
                <tr><td className="py-1.5">Revenue collected (paid invoice batches)</td><td className="text-right">{fmtMoney(r.revenueCollectedCents)}</td></tr>
                <tr className="text-muted-foreground"><td className="py-1.5">− Operating expenses (non-reimbursable)</td><td className="text-right">−{fmtMoney(r.operatingExpenseCents)}</td></tr>
                <tr className="text-muted-foreground"><td className="py-1.5">− Payroll burden (gross + employer tax, finalized runs)</td><td className="text-right">−{fmtMoney(r.payrollBurdenCents)}</td></tr>
                <tr className="text-muted-foreground"><td className="py-1.5">− Tax reserve</td><td className="text-right">−{fmtMoney(r.taxReserveCents)}</td></tr>
                <tr className="text-muted-foreground"><td className="py-1.5">− Operating reserve</td><td className="text-right">−{fmtMoney(r.operatingReserveCents)}</td></tr>
                {r.waBoAccrualCents > 0 && (
                  <tr className="text-muted-foreground"><td className="py-1.5">− WA B&amp;O accrual</td><td className="text-right">−{fmtMoney(r.waBoAccrualCents)}</td></tr>
                )}
                <tr className="border-t font-semibold"><td className="py-2">Available funds</td><td className="text-right">{fmtMoney(r.availableFundsCents)}</td></tr>
              </tbody>
            </table>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Owner pool · {fmtMoney(r.ownerPoolCents)}</CardTitle>
              <p className="text-xs text-muted-foreground">Paid via non-payroll ACH (no withholding).</p>
            </CardHeader>
            <CardContent>
              {ownerLines.length === 0 ? (
                <div className="text-sm text-muted-foreground">No owner lines. Run Preview.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground border-b">
                    <tr><th className="py-1.5">Owner</th><th className="text-right">Share</th><th className="text-right">Amount</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {ownerLines.map(l => (
                      <tr key={l.id} className="border-b last:border-0" data-testid={`line-owner-${l.id}`}>
                        <td className="py-1.5 font-medium">{l.recipient?.name ?? l.recipient?.email ?? l.recipientUserId}</td>
                        <td className="text-right">{(Number(l.weight) * 100).toFixed(2)}%</td>
                        <td className="text-right font-medium">{fmtMoney(l.amountCents)}</td>
                        <td><span className="px-2 py-0.5 text-xs rounded bg-accent">{l.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">FTE pool · {fmtMoney(r.ftePoolCents)}</CardTitle>
              <p className="text-xs text-muted-foreground">Paid through a supplemental bonus payroll run (22% supplemental fed + FICA).</p>
            </CardHeader>
            <CardContent>
              {fteLines.length === 0 ? (
                <div className="text-sm text-muted-foreground">No FTE lines. Run Preview.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground border-b">
                    <tr><th className="py-1.5">Employee</th><th className="text-right">Share</th><th className="text-right">Amount</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {fteLines.map(l => (
                      <tr key={l.id} className="border-b last:border-0" data-testid={`line-fte-${l.id}`}>
                        <td className="py-1.5 font-medium">{l.recipient?.name ?? l.recipient?.email ?? l.recipientUserId}</td>
                        <td className="text-right">{(Number(l.weight) * 100).toFixed(2)}%</td>
                        <td className="text-right font-medium">{fmtMoney(l.amountCents)}</td>
                        <td><span className="px-2 py-0.5 text-xs rounded bg-accent">{l.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
