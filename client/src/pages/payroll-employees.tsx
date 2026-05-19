import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { fmtDate } from "@/lib/payroll-format";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { Plus } from "lucide-react";

export default function PayrollEmployees() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ employeeType: 'w2', status: 'onboarding', filingStatus: 'single' });
  const { toast } = useToast();
  const { data: employees, isLoading } = useQuery<any[]>({ queryKey: ["/api/payroll/employees"] });
  const { data: schedules } = useQuery<any[]>({ queryKey: ["/api/payroll/schedules"] });
  const { data: eligibleUsers } = useQuery<Array<{ id: string; name: string; email: string }>>({ queryKey: ["/api/payroll/eligible-users"] });

  function selectUser(userId: string) {
    if (userId === 'none') {
      setForm((f: any) => ({ ...f, userId: null }));
      return;
    }
    const u = (eligibleUsers || []).find(x => x.id === userId);
    if (!u) return;
    const [first, ...rest] = (u.name || '').split(' ');
    setForm((f: any) => ({
      ...f,
      userId: u.id,
      email: u.email,
      firstName: f.firstName || first || '',
      lastName: f.lastName || rest.join(' ') || '',
    }));
  }

  const create = useMutation({
    mutationFn: (data: any) => apiRequest("/api/payroll/employees", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/employees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/eligible-users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setOpen(false); setForm({ employeeType: 'w2', status: 'onboarding', filingStatus: 'single' });
      toast({ title: "Employee added" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Layout>
      <div className="p-6 space-y-6" data-testid="page-payroll-employees">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Employees & Contractors</h1>
            <p className="text-sm text-muted-foreground">W-2 employees and 1099 contractors enrolled in payroll.</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-employee"><Plus className="h-4 w-4 mr-2" />Add person</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader><DialogTitle>Onboard a new person</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-4 py-2">
                <div className="col-span-2">
                  <Label>Link to internal user (optional)</Label>
                  <Select value={form.userId || 'none'} onValueChange={selectUser}>
                    <SelectTrigger data-testid="select-link-user"><SelectValue placeholder="Not linked — create standalone payroll record" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not linked</SelectItem>
                      {(eligibleUsers || []).map(u => (
                        <SelectItem key={u.id} value={u.id}>{u.name} — {u.email}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">Picking a user pre-fills the form and links the two records so you don't have duplicates.</p>
                </div>
                <div><Label>First name</Label><Input value={form.firstName || ''} onChange={e => setForm({ ...form, firstName: e.target.value })} data-testid="input-first-name" /></div>
                <div><Label>Last name</Label><Input value={form.lastName || ''} onChange={e => setForm({ ...form, lastName: e.target.value })} data-testid="input-last-name" /></div>
                <div className="col-span-2"><Label>Email</Label><Input value={form.email || ''} onChange={e => setForm({ ...form, email: e.target.value })} data-testid="input-email" /></div>
                <div><Label>Type</Label>
                  <Select value={form.employeeType} onValueChange={v => setForm({ ...form, employeeType: v })}>
                    <SelectTrigger data-testid="select-emp-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="w2">W-2 employee</SelectItem>
                      <SelectItem value="1099">1099 contractor</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Hire date</Label><Input type="date" value={form.hireDate || ''} onChange={e => setForm({ ...form, hireDate: e.target.value })} /></div>
                <div><Label>Filing status</Label>
                  <Select value={form.filingStatus} onValueChange={v => setForm({ ...form, filingStatus: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="single">Single</SelectItem>
                      <SelectItem value="married_jointly">Married filing jointly</SelectItem>
                      <SelectItem value="head_of_household">Head of household</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Work state</Label><Input maxLength={2} value={form.workStateCode || ''} onChange={e => setForm({ ...form, workStateCode: e.target.value.toUpperCase() })} /></div>
                <div className="col-span-2"><Label>Default pay schedule</Label>
                  <Select value={form.defaultPayScheduleId || ''} onValueChange={v => setForm({ ...form, defaultPayScheduleId: v })}>
                    <SelectTrigger><SelectValue placeholder="Pick a schedule" /></SelectTrigger>
                    <SelectContent>
                      {(schedules || []).map(s => <SelectItem key={s.id} value={s.id}>{s.name} ({s.frequency})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={() => create.mutate(form)} disabled={create.isPending} data-testid="button-create-employee">
                  {create.isPending ? "Creating..." : "Create"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardHeader><CardTitle>People</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? <div className="text-sm text-muted-foreground">Loading…</div> :
              !employees || employees.length === 0 ? <div className="text-sm text-muted-foreground">No people yet.</div> : (
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground border-b">
                  <tr><th className="py-2">Name</th><th>Email</th><th>Type</th><th>Status</th><th>Linked user</th><th>Hired</th><th></th></tr>
                </thead>
                <tbody>
                  {employees.map(e => (
                    <tr key={e.id} className="border-b last:border-0" data-testid={`row-employee-${e.id}`}>
                      <td className="py-2 font-medium">{e.firstName} {e.lastName}</td>
                      <td>{e.email}</td>
                      <td><span className="px-2 py-0.5 text-xs rounded bg-accent">{e.employeeType}</span></td>
                      <td><span className="px-2 py-0.5 text-xs rounded bg-accent">{e.status}</span></td>
                      <td>
                        {e.linkedUser ? (
                          <Link href={`/users?highlight=${e.linkedUser.id}`}>
                            <span className="text-primary underline cursor-pointer" data-testid={`link-user-${e.id}`}>{e.linkedUser.name}</span>
                          </Link>
                        ) : (
                          <span className="text-muted-foreground text-xs">unlinked</span>
                        )}
                      </td>
                      <td>{fmtDate(e.hireDate)}</td>
                      <td className="text-right"><Link href={`/payroll/employees/${e.id}`}><Button variant="link" size="sm">Open</Button></Link></td>
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
