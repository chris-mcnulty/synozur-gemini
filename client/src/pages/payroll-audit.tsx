import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function PayrollAudit() {
  const { data: log } = useQuery<any[]>({ queryKey: ["/api/payroll/audit-log"] });
  return (
    <Layout>
      <div className="p-6 space-y-6">
        <div><h1 className="text-2xl font-semibold">Payroll audit log</h1>
          <p className="text-sm text-muted-foreground">Every payroll-relevant action: who did what, on which entity, and when.</p></div>
        <Card>
          <CardHeader><CardTitle>Recent activity</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground border-b">
                <tr><th className="py-2">When</th><th>Action</th><th>Entity</th><th>Details</th></tr>
              </thead>
              <tbody>
                {(log || []).map(e => (
                  <tr key={e.id} className="border-b last:border-0">
                    <td className="py-2">{new Date(e.occurredAt).toLocaleString()}</td>
                    <td><code className="text-xs">{e.action}</code></td>
                    <td>{e.entityType} <span className="text-muted-foreground">{e.entityId?.slice(0, 8)}</span></td>
                    <td className="text-xs text-muted-foreground">{e.details ? JSON.stringify(e.details) : ''}</td>
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
