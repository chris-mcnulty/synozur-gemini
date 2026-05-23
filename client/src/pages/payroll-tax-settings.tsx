import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface TaxFilingSettings {
  bsoUserId: string;
  softwareVendorCode: string;
  irsTcc: string;
  filerName: string;
  filerAddress: {
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    stateCode?: string;
    zip?: string;
  };
  filerContact: {
    name?: string;
    phone?: string;
    email?: string;
  };
}

/**
 * Tenant-scoped SSA / IRS filer credentials. The EFW2 and FIRE generators
 * default to these values so admins don't have to retype them on every
 * year-end filing. Values are stored in tenant_settings (plain text — BSO
 * User IDs and TCCs aren't secrets per se, but they're tenant-specific).
 */
export default function PayrollTaxSettings() {
  const { data, isLoading } = useQuery<TaxFilingSettings>({
    queryKey: ["/api/payroll/tax-filing-settings"],
  });
  const { toast } = useToast();
  const [form, setForm] = useState<TaxFilingSettings>({
    bsoUserId: '', softwareVendorCode: '', irsTcc: '', filerName: '',
    filerAddress: {}, filerContact: {},
  });

  useEffect(() => { if (data) setForm(data); }, [data]);

  const save = useMutation({
    mutationFn: (body: TaxFilingSettings) => apiRequest("/api/payroll/tax-filing-settings", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/tax-filing-settings"] });
      toast({ title: "Settings saved", description: "Year-end filings will use these defaults." });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Layout>
      <div className="p-6 space-y-6 max-w-4xl">
        <div>
          <h1 className="text-2xl font-semibold">Tax filing settings</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Credentials and filer info used by the SSA EFW2 (W-2 e-file) and IRS FIRE (1099-NEC e-file)
            generators. Test files against SSA AccuWage and IRS FIRE-test before any production submission.
          </p>
        </div>

        {isLoading && <p>Loading…</p>}

        <Card>
          <CardHeader><CardTitle>SSA Business Services Online (W-2 / EFW2)</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div>
              <Label>BSO User ID</Label>
              <Input
                value={form.bsoUserId}
                onChange={e => setForm({ ...form, bsoUserId: e.target.value })}
                placeholder="8 chars, starts with a letter"
                maxLength={8}
                data-testid="input-bso-user-id"
              />
              <p className="text-xs text-muted-foreground mt-1">SSA-issued. Required for EFW2 submission.</p>
            </div>
            <div>
              <Label>Software vendor code</Label>
              <Input
                value={form.softwareVendorCode}
                onChange={e => setForm({ ...form, softwareVendorCode: e.target.value.toUpperCase() })}
                placeholder="4 chars (optional)"
                maxLength={4}
                data-testid="input-vendor-code"
              />
              <p className="text-xs text-muted-foreground mt-1">SSA-assigned for vendored software. Blank for in-house.</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>IRS FIRE (1099-NEC / 1099-DIV)</CardTitle></CardHeader>
          <CardContent>
            <div>
              <Label>Transmitter Control Code (TCC)</Label>
              <Input
                value={form.irsTcc}
                onChange={e => setForm({ ...form, irsTcc: e.target.value.toUpperCase() })}
                placeholder="5 chars"
                maxLength={5}
                className="max-w-xs"
                data-testid="input-irs-tcc"
              />
              <p className="text-xs text-muted-foreground mt-1">IRS-issued (Form 4419 / IR Application for TCC). Required for FIRE submission.</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Filer / employer information</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>Legal name on filing</Label>
              <Input
                value={form.filerName}
                onChange={e => setForm({ ...form, filerName: e.target.value })}
                maxLength={57}
                placeholder="Defaults to your ACH originator company name when blank"
              />
            </div>
            <div className="col-span-2">
              <Label>Address line 1</Label>
              <Input value={form.filerAddress.addressLine1 || ''} onChange={e => setForm({ ...form, filerAddress: { ...form.filerAddress, addressLine1: e.target.value } })} />
            </div>
            <div className="col-span-2">
              <Label>Address line 2</Label>
              <Input value={form.filerAddress.addressLine2 || ''} onChange={e => setForm({ ...form, filerAddress: { ...form.filerAddress, addressLine2: e.target.value } })} />
            </div>
            <div><Label>City</Label><Input value={form.filerAddress.city || ''} onChange={e => setForm({ ...form, filerAddress: { ...form.filerAddress, city: e.target.value } })} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>State</Label><Input maxLength={2} value={form.filerAddress.stateCode || ''} onChange={e => setForm({ ...form, filerAddress: { ...form.filerAddress, stateCode: e.target.value.toUpperCase() } })} /></div>
              <div><Label>ZIP</Label><Input maxLength={10} value={form.filerAddress.zip || ''} onChange={e => setForm({ ...form, filerAddress: { ...form.filerAddress, zip: e.target.value } })} /></div>
            </div>
            <div><Label>Contact name</Label><Input value={form.filerContact.name || ''} onChange={e => setForm({ ...form, filerContact: { ...form.filerContact, name: e.target.value } })} /></div>
            <div><Label>Contact phone</Label><Input value={form.filerContact.phone || ''} onChange={e => setForm({ ...form, filerContact: { ...form.filerContact, phone: e.target.value } })} placeholder="digits only, 10" /></div>
            <div className="col-span-2"><Label>Contact email</Label><Input value={form.filerContact.email || ''} onChange={e => setForm({ ...form, filerContact: { ...form.filerContact, email: e.target.value } })} /></div>
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button onClick={() => save.mutate(form)} disabled={save.isPending} data-testid="button-save-tax-settings">
            {save.isPending ? 'Saving…' : 'Save settings'}
          </Button>
          <a className="inline-flex" href="https://www.ssa.gov/employer/" target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm">SSA BSO portal ↗</Button>
          </a>
          <a className="inline-flex" href="https://fire.test.irs.gov/" target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm">IRS FIRE test ↗</Button>
          </a>
        </div>
      </div>
    </Layout>
  );
}
