import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Layout } from "@/components/layout/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Handshake, DollarSign, Calendar, ExternalLink, Plus, AlertTriangle, ArrowLeft, Search, Link2, Unlink, X, Filter } from "lucide-react";

interface EstimateMapping {
  localObjectId: string;
  estimateName: string;
  mappingId: string;
}

interface HubSpotDeal {
  id: string;
  dealName: string;
  amount: string | number | null;
  dealStage: string;
  dealStageName: string;
  pipeline: string;
  pipelineName: string;
  probability: number;
  closeDate: string;
  ownerName: string;
  companyName: string;
  companyId: string;
  createdAt: string;
  updatedAt: string;
  isMapped: boolean;
  mappings: EstimateMapping[];
  mapping: { localObjectId: string } | null;
  companyLinked: boolean;
  linkedClientId: string | null;
}

interface DealsResponse {
  deals: HubSpotDeal[];
  threshold: number;
  total: number;
  mapped: number;
}

interface CrmStatus {
  provider: string;
  tenantConnected: boolean;
  tenantEnabled: boolean;
  dealProbabilityThreshold: number;
}

interface Client {
  id: string;
  name: string;
}

interface Estimate {
  id: string;
  name: string;
  clientId: string;
  clientName?: string;
  status: string;
  totalFees?: string | number | null;
}

function formatCurrency(amount: string | number | null): string {
  if (amount === null || amount === undefined) return "—";
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(num);
}

type DateRangePreset = "all" | "current_quarter" | "next_quarter" | "this_year" | "custom";

function getQuarterRange(offset: number = 0): { start: Date; end: Date } {
  const now = new Date();
  const currentQuarter = Math.floor(now.getMonth() / 3) + offset;
  const year = now.getFullYear() + Math.floor(currentQuarter / 4);
  const quarter = ((currentQuarter % 4) + 4) % 4;
  const start = new Date(year, quarter * 3, 1);
  const end = new Date(year, quarter * 3 + 3, 0, 23, 59, 59);
  return { start, end };
}

function getDateRange(preset: DateRangePreset): { start: Date | null; end: Date | null } {
  switch (preset) {
    case "current_quarter": {
      const { start, end } = getQuarterRange(0);
      return { start, end };
    }
    case "next_quarter": {
      const { start, end } = getQuarterRange(1);
      return { start, end };
    }
    case "this_year": {
      const now = new Date();
      return { start: new Date(now.getFullYear(), 0, 1), end: new Date(now.getFullYear(), 11, 31, 23, 59, 59) };
    }
    default:
      return { start: null, end: null };
  }
}

function formatDateRange(preset: DateRangePreset): string {
  const range = getDateRange(preset);
  if (!range.start || !range.end) return "";
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(range.start)} – ${fmt(range.end)}, ${range.end.getFullYear()}`;
}

const WON_STAGE_KEYS = ["closedwon", "won", "closed won"];
const LOST_STAGE_KEYS = ["closedlost", "lost", "closed lost"];

function isWonStage(stageName: string, stageKey: string): boolean {
  return WON_STAGE_KEYS.includes(stageKey.toLowerCase()) || WON_STAGE_KEYS.includes(stageName.toLowerCase());
}

function isLostStage(stageName: string, stageKey: string): boolean {
  return LOST_STAGE_KEYS.includes(stageKey.toLowerCase()) || LOST_STAGE_KEYS.includes(stageName.toLowerCase());
}

function isClosedStage(stageName: string, stageKey: string): boolean {
  return isWonStage(stageName, stageKey) || isLostStage(stageName, stageKey);
}

export default function CrmDeals() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [searchTerm, setSearchTerm] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("active");
  const [dateRangePreset, setDateRangePreset] = useState<DateRangePreset>("current_quarter");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogTab, setDialogTab] = useState<string>("link");
  const [selectedDeal, setSelectedDeal] = useState<HubSpotDeal | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [selectedEstimateId, setSelectedEstimateId] = useState<string>("");
  const [estimateName, setEstimateName] = useState("");

  const { data: crmStatus, isLoading: isLoadingStatus } = useQuery<CrmStatus>({
    queryKey: ["/api/crm/status"],
  });

  const { data: dealsData, isLoading: isLoadingDeals } = useQuery<DealsResponse>({
    queryKey: ["/api/crm/deals"],
    enabled: crmStatus?.tenantEnabled === true,
  });

  const { data: clients } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
    enabled: dialogOpen,
  });

  const { data: estimates } = useQuery<Estimate[]>({
    queryKey: ["/api/estimates"],
    enabled: dialogOpen,
  });

  const linkedClientEstimates = estimates?.filter(est => {
    if (!selectedDeal) return true;
    if (selectedDeal.linkedClientId) {
      return est.clientId === selectedDeal.linkedClientId;
    }
    return true;
  }) ?? [];

  const alreadyLinkedIds = new Set(selectedDeal?.mappings?.map(m => m.localObjectId) || []);
  const availableEstimates = linkedClientEstimates.filter(est => !alreadyLinkedIds.has(est.id));

  const createEstimateMutation = useMutation({
    mutationFn: (dealId: string) =>
      apiRequest(`/api/crm/deals/${dealId}/create-estimate`, {
        method: "POST",
        body: JSON.stringify({
          clientId: selectedClientId && selectedClientId !== "auto" ? selectedClientId : undefined,
          estimateName: estimateName || undefined,
        }),
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
      toast({ title: "Estimate created", description: "Estimate created and linked to deal successfully." });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create estimate", description: error.message, variant: "destructive" });
    },
  });

  const linkEstimateMutation = useMutation({
    mutationFn: ({ dealId, estimateId }: { dealId: string; estimateId: string }) =>
      apiRequest(`/api/crm/deals/${dealId}/link-estimate`, {
        method: "POST",
        body: JSON.stringify({ estimateId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals"] });
      toast({ title: "Estimate linked", description: "Existing estimate linked to deal successfully." });
      setSelectedEstimateId("");
    },
    onError: (error: Error) => {
      toast({ title: "Failed to link estimate", description: error.message, variant: "destructive" });
    },
  });

  const unlinkEstimateMutation = useMutation({
    mutationFn: ({ dealId, estimateId }: { dealId: string; estimateId: string }) =>
      apiRequest(`/api/crm/deals/${dealId}/unlink-estimate/${estimateId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals"] });
      toast({ title: "Estimate unlinked", description: "Estimate unlinked from deal." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to unlink estimate", description: error.message, variant: "destructive" });
    },
  });

  const openDealDialog = (deal: HubSpotDeal) => {
    setSelectedDeal(deal);
    setEstimateName(deal.dealName);
    setSelectedClientId(deal.linkedClientId || "auto");
    setSelectedEstimateId("");
    setDialogTab(deal.companyLinked ? "link" : "create");
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setSelectedDeal(null);
    setSelectedClientId("");
    setEstimateName("");
    setSelectedEstimateId("");
  };

  const handleCreateEstimate = () => {
    if (!selectedDeal) return;
    createEstimateMutation.mutate(selectedDeal.id);
  };

  const handleLinkEstimate = () => {
    if (!selectedDeal || !selectedEstimateId) return;
    linkEstimateMutation.mutate({ dealId: selectedDeal.id, estimateId: selectedEstimateId });
  };

  const uniqueStages = useMemo(() => {
    if (!dealsData?.deals) return [];
    const stageMap = new Map<string, string>();
    for (const deal of dealsData.deals) {
      if (deal.dealStage && !stageMap.has(deal.dealStage)) {
        stageMap.set(deal.dealStage, deal.dealStageName || deal.dealStage);
      }
    }
    return Array.from(stageMap.entries()).map(([key, name]) => ({ key, name, isWon: isWonStage(name, key) }));
  }, [dealsData?.deals]);

  const filteredDeals = useMemo(() => {
    if (!dealsData?.deals) return [];
    const dateRange = getDateRange(dateRangePreset);
    return dealsData.deals.filter((deal) => {
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const matchesSearch =
          deal.dealName.toLowerCase().includes(term) ||
          deal.companyName?.toLowerCase().includes(term) ||
          deal.ownerName?.toLowerCase().includes(term) ||
          deal.dealStageName?.toLowerCase().includes(term);
        if (!matchesSearch) return false;
      }

      if (stageFilter === "active") {
        if (isClosedStage(deal.dealStageName || "", deal.dealStage)) return false;
      } else if (stageFilter === "won") {
        if (!isWonStage(deal.dealStageName || "", deal.dealStage)) return false;
      } else if (stageFilter === "lost") {
        if (!isLostStage(deal.dealStageName || "", deal.dealStage)) return false;
      } else if (stageFilter !== "all") {
        if (deal.dealStage !== stageFilter) return false;
      }

      if (dateRange.start && dateRange.end) {
        if (!deal.closeDate) return false;
        const closeDate = new Date(deal.closeDate);
        if (closeDate < dateRange.start || closeDate > dateRange.end) return false;
      }

      return true;
    });
  }, [dealsData?.deals, searchTerm, stageFilter, dateRangePreset]);

  if (isLoadingStatus) {
    return (
      <Layout>
        <div className="container mx-auto py-8 px-4 max-w-7xl space-y-6">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-6 w-96" />
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </div>
      </Layout>
    );
  }

  if (!crmStatus?.tenantConnected || !crmStatus?.tenantEnabled) {
    return (
      <Layout>
        <div className="container mx-auto py-8 px-4 max-w-7xl">
          <div className="flex items-center gap-3 mb-8">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Handshake className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">CRM Deals</h1>
            </div>
          </div>
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {!crmStatus?.tenantConnected
                ? "HubSpot is not connected for your organization. Connect it in Organization Settings."
                : "HubSpot sync is not enabled for your organization. Enable it in Organization Settings to view CRM deals."}
            </AlertDescription>
          </Alert>
          <div className="mt-4">
            <Button variant="outline" onClick={() => navigate("/organization-settings")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Organization Settings
            </Button>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto py-8 px-4 max-w-7xl">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Handshake className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">CRM Deals</h1>
              <p className="text-sm text-muted-foreground">
                {isLoadingDeals
                  ? "Loading deals..."
                  : `${dealsData?.total ?? 0} deals above ${dealsData?.threshold ?? 0}% probability · ${dealsData?.mapped ?? 0} with linked estimates`}
              </p>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-4">
              <CardTitle className="text-base">HubSpot Deals</CardTitle>
              <div className="relative w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search deals..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Stage:</span>
                <Select value={stageFilter} onValueChange={setStageFilter}>
                  <SelectTrigger className="w-[160px] h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active (Open)</SelectItem>
                    <SelectItem value="won">Won</SelectItem>
                    <SelectItem value="lost">Lost</SelectItem>
                    <SelectItem value="all">All Stages</SelectItem>
                    {uniqueStages.length > 0 && (
                      <>
                        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground border-t mt-1 pt-1">
                          Individual Stages
                        </div>
                        {uniqueStages.map((stage) => (
                          <SelectItem key={stage.key} value={stage.key}>
                            {stage.name}
                          </SelectItem>
                        ))}
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Close Date:</span>
                <Select value={dateRangePreset} onValueChange={(v) => setDateRangePreset(v as DateRangePreset)}>
                  <SelectTrigger className="w-[180px] h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="current_quarter">Current Quarter</SelectItem>
                    <SelectItem value="next_quarter">Next Quarter</SelectItem>
                    <SelectItem value="this_year">This Year</SelectItem>
                    <SelectItem value="all">All Dates</SelectItem>
                  </SelectContent>
                </Select>
                {dateRangePreset !== "all" && (
                  <span className="text-xs text-muted-foreground">
                    {formatDateRange(dateRangePreset)}
                  </span>
                )}
              </div>
              {filteredDeals.length !== (dealsData?.deals?.length ?? 0) && (
                <Badge variant="secondary" className="text-xs">
                  {filteredDeals.length} of {dealsData?.deals?.length ?? 0} deals
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {isLoadingDeals ? (
              <div className="space-y-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : filteredDeals.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                {searchTerm || stageFilter !== "all" || dateRangePreset !== "all"
                  ? "No deals match your current filters."
                  : "No deals found above the probability threshold."}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Deal Name</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Stage</TableHead>
                      <TableHead className="text-center">Probability</TableHead>
                      <TableHead>Close Date</TableHead>
                      <TableHead>Linked Estimates</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredDeals.map((deal) => (
                      <TableRow key={deal.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{deal.dealName}</p>
                            {deal.companyName && (
                              <div className="flex items-center gap-1">
                                <p className="text-xs text-muted-foreground">{deal.companyName}</p>
                                {deal.companyLinked && (
                                  <Badge variant="outline" className="text-[10px] px-1 py-0 text-green-600 border-green-600">
                                    Client linked
                                  </Badge>
                                )}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {deal.amount ? formatCurrency(deal.amount) : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{deal.dealStageName || deal.dealStage}</Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            variant={deal.probability >= 80 ? "default" : deal.probability >= 50 ? "secondary" : "outline"}
                          >
                            {deal.probability}%
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {deal.closeDate
                            ? new Date(deal.closeDate).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })
                            : "—"}
                        </TableCell>
                        <TableCell>
                          {deal.mappings && deal.mappings.length > 0 ? (
                            <div className="flex flex-col gap-1">
                              {deal.mappings.map((m) => (
                                <div key={m.localObjectId} className="flex items-center gap-1.5">
                                  <span className="text-xs truncate max-w-[200px]">
                                    {m.estimateName}
                                  </span>
                                  <button
                                    onClick={() => unlinkEstimateMutation.mutate({ dealId: deal.id, estimateId: m.localObjectId })}
                                    className="text-muted-foreground hover:text-destructive shrink-0"
                                    title="Unlink estimate"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">None</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openDealDialog(deal)}
                          >
                            <Link2 className="h-4 w-4 mr-1" />
                            Link Estimate
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Link Estimates to Deal</DialogTitle>
            <DialogDescription>
              {selectedDeal?.dealName}
              {selectedDeal?.amount ? ` · ${formatCurrency(selectedDeal.amount)}` : ""}
              {selectedDeal?.companyName ? ` · ${selectedDeal.companyName}` : ""}
            </DialogDescription>
          </DialogHeader>

          {selectedDeal && selectedDeal.mappings.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Currently Linked</Label>
              <div className="space-y-1">
                {selectedDeal.mappings.map((m) => (
                  <div key={m.localObjectId} className="flex items-center justify-between bg-muted/50 rounded px-3 py-1.5 text-sm">
                    <span className="truncate">
                      {m.estimateName}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        unlinkEstimateMutation.mutate({ dealId: selectedDeal.id, estimateId: m.localObjectId });
                        setSelectedDeal({
                          ...selectedDeal,
                          mappings: selectedDeal.mappings.filter(x => x.localObjectId !== m.localObjectId),
                        });
                      }}
                    >
                      <Unlink className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Tabs value={dialogTab} onValueChange={setDialogTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="link">Link Existing</TabsTrigger>
              <TabsTrigger value="create">Create New</TabsTrigger>
            </TabsList>

            <TabsContent value="link" className="space-y-4 pt-2">
              {!selectedDeal?.companyLinked && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    This deal's HubSpot company is not linked to a client. Showing all estimates. Link the company to a client first for filtered results.
                  </AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label>Select Estimate</Label>
                <Select value={selectedEstimateId} onValueChange={setSelectedEstimateId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose an estimate to link..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableEstimates.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        No available estimates{selectedDeal?.companyLinked ? " for this client" : ""}
                      </div>
                    ) : (
                      availableEstimates.map((est) => (
                        <SelectItem key={est.id} value={est.id}>
                          <div className="flex items-center gap-2">
                            <span className="truncate">{est.clientName || "No Client"} — {est.name}</span>
                            <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">
                              {est.status}
                            </Badge>
                          </div>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {selectedDeal?.companyLinked && (
                  <p className="text-xs text-muted-foreground">
                    Showing estimates for the linked client only.
                  </p>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeDialog}>Cancel</Button>
                <Button
                  onClick={handleLinkEstimate}
                  disabled={!selectedEstimateId || linkEstimateMutation.isPending}
                >
                  {linkEstimateMutation.isPending ? "Linking..." : "Link Estimate"}
                </Button>
              </DialogFooter>
            </TabsContent>

            <TabsContent value="create" className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Estimate Name</Label>
                <Input
                  value={estimateName}
                  onChange={(e) => setEstimateName(e.target.value)}
                  placeholder="Enter estimate name"
                />
              </div>
              <div className="space-y-2">
                <Label>Client</Label>
                <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a client" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto-detect from HubSpot</SelectItem>
                    {clients?.map((client) => (
                      <SelectItem key={client.id} value={client.id}>
                        {client.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Choose "Auto-detect" to match the client from HubSpot company data, or select an existing client.
                </p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeDialog}>Cancel</Button>
                <Button
                  onClick={handleCreateEstimate}
                  disabled={createEstimateMutation.isPending}
                >
                  {createEstimateMutation.isPending ? "Creating..." : "Create Estimate"}
                </Button>
              </DialogFooter>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
