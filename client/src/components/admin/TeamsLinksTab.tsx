import { useState, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ExternalLink,
  Unlink,
  RefreshCw,
  Search,
  Building2,
  FolderOpen,
  FileText,
  AlertTriangle,
  Link2,
  Link2Off,
  Loader2,
  Lock,
} from "lucide-react";
import { MicrosoftTeamsIcon } from "@/components/icons/microsoft-icons";

interface TeamLink {
  teamId: string;
  teamName: string | null;
  teamWebUrl: string | null;
  source: "client_teams" | "legacy";
}

interface ProjectLink {
  id: string;
  name: string;
  code: string | null;
  clientId: string | null;
  status: string | null;
  channelId: string | null;
  channelName: string | null;
  channelWebUrl: string | null;
  plannerPlanId: string | null;
  plannerPlanWebUrl: string | null;
}

interface EstimateLink {
  id: string;
  name: string;
  clientId: string | null;
  status: string | null;
  teamId: string | null;
  teamName: string | null;
  channelId: string | null;
  channelName: string | null;
  channelWebUrl: string | null;
}

interface ClientGroup {
  clientId: string;
  clientName: string;
  team: TeamLink | null;
  projects: ProjectLink[];
  estimates: EstimateLink[];
}

interface TeamsLinksResponse {
  groups: ClientGroup[];
  orphanProjects: ProjectLink[];
  orphanEstimates: EstimateLink[];
}

type PendingAction =
  | { type: "unlinkClientTeam"; clientId: string; clientName: string }
  | { type: "unlinkProjectChannel"; projectId: string; projectName: string }
  | { type: "unlinkEstimateChannel"; estimateId: string; estimateName: string };

interface LinkTeamDialogState {
  clientId: string;
  clientName: string;
}

interface LinkProjectChannelDialogState {
  projectId: string;
  projectName: string;
  clientTeamId: string | null;
  clientTeamName: string | null;
}

export function TeamsLinksTab() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [linkTeamDialog, setLinkTeamDialog] = useState<LinkTeamDialogState | null>(null);
  const [linkChannelDialog, setLinkChannelDialog] = useState<LinkProjectChannelDialogState | null>(null);

  const { data, isLoading, error } = useQuery<TeamsLinksResponse>({
    queryKey: ["/api/org/teams-links"],
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/org/teams-links"] });
  };

  const unlinkClientTeam = useMutation({
    mutationFn: (clientId: string) =>
      apiRequest(`/api/clients/${clientId}/microsoft-team`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Client unlinked from Team" });
      invalidate();
    },
    onError: (e: Error) =>
      toast({ title: "Failed to unlink team", description: e.message, variant: "destructive" }),
  });

  const unlinkProjectChannel = useMutation({
    mutationFn: (projectId: string) =>
      apiRequest(`/api/projects/${projectId}/channel`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Project channel unlinked" });
      invalidate();
    },
    onError: (e: Error) =>
      toast({ title: "Failed to unlink channel", description: e.message, variant: "destructive" }),
  });

  const unlinkEstimateChannel = useMutation({
    mutationFn: (estimateId: string) =>
      apiRequest(`/api/estimates/${estimateId}/channel`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Estimate channel unlinked" });
      invalidate();
    },
    onError: (e: Error) =>
      toast({ title: "Failed to unlink channel", description: e.message, variant: "destructive" }),
  });

  const confirmAction = () => {
    if (!pending) return;
    if (pending.type === "unlinkClientTeam") unlinkClientTeam.mutate(pending.clientId);
    if (pending.type === "unlinkProjectChannel") unlinkProjectChannel.mutate(pending.projectId);
    if (pending.type === "unlinkEstimateChannel") unlinkEstimateChannel.mutate(pending.estimateId);
    setPending(null);
  };

  const filteredGroups = useMemo(() => {
    if (!data?.groups) return [];
    const q = search.trim().toLowerCase();
    const groups = q
      ? data.groups.filter((g) => {
          if (g.clientName?.toLowerCase().includes(q)) return true;
          if (g.team?.teamName?.toLowerCase().includes(q)) return true;
          if (g.projects.some((p) => p.name?.toLowerCase().includes(q) || p.channelName?.toLowerCase().includes(q))) return true;
          if (g.estimates.some((e) => e.name?.toLowerCase().includes(q) || e.channelName?.toLowerCase().includes(q))) return true;
          return false;
        })
      : [...data.groups];
    return groups.sort((a, b) => (a.clientName ?? "").localeCompare(b.clientName ?? ""));
  }, [data, search]);

  const totalClients = data?.groups.length ?? 0;
  const clientsWithTeam = data?.groups.filter((g) => g.team).length ?? 0;
  const linkedProjects = data?.groups.reduce((acc, g) => acc + g.projects.filter((p) => p.channelId).length, 0) ?? 0;
  const linkedEstimates = data?.groups.reduce((acc, g) => acc + g.estimates.filter((e) => e.channelId).length, 0) ?? 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MicrosoftTeamsIcon className="h-5 w-5" />
            Teams & Channels Overview
          </CardTitle>
          <CardDescription>
            View all Microsoft Teams, projects, and estimate channel links grouped by client. You can unlink or
            re-create any connection here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Clients" value={totalClients} />
            <StatCard label="Clients with Team" value={clientsWithTeam} />
            <StatCard label="Linked Projects" value={linkedProjects} />
            <StatCard label="Linked Estimates" value={linkedEstimates} />
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search by client, team, project, estimate, or channel name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-teams-links-search"
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{(error as Error).message}</AlertDescription>
            </Alert>
          )}

          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : filteredGroups.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-sm">
              {search ? "No matching clients, projects, or estimates." : "No clients found for this tenant."}
            </div>
          ) : (
            <Accordion type="multiple" className="w-full border rounded-md">
              {filteredGroups.map((group) => (
                <ClientGroupRow
                  key={group.clientId}
                  group={group}
                  navigate={setLocation}
                  onUnlinkTeam={() =>
                    setPending({
                      type: "unlinkClientTeam",
                      clientId: group.clientId,
                      clientName: group.clientName,
                    })
                  }
                  onLinkTeam={() =>
                    setLinkTeamDialog({ clientId: group.clientId, clientName: group.clientName })
                  }
                  onUnlinkProjectChannel={(p) =>
                    setPending({
                      type: "unlinkProjectChannel",
                      projectId: p.id,
                      projectName: p.name,
                    })
                  }
                  onLinkProjectChannel={(p) =>
                    setLinkChannelDialog({
                      projectId: p.id,
                      projectName: p.name,
                      clientTeamId: group.team?.teamId ?? null,
                      clientTeamName: group.team?.teamName ?? null,
                    })
                  }
                  onUnlinkEstimateChannel={(e) =>
                    setPending({
                      type: "unlinkEstimateChannel",
                      estimateId: e.id,
                      estimateName: e.name,
                    })
                  }
                />
              ))}
            </Accordion>
          )}

          {(data?.orphanProjects.length ?? 0) > 0 || (data?.orphanEstimates.length ?? 0) > 0 ? (
            <div className="mt-6">
              <h4 className="text-sm font-semibold mb-2 text-muted-foreground">Unassigned (no matching client)</h4>
              <div className="space-y-2 border rounded-md p-3">
                {data?.orphanProjects.map((p) => (
                  <ProjectRow
                    key={`orphan-proj-${p.id}`}
                    project={p}
                    navigate={setLocation}
                    onUnlink={() =>
                      setPending({ type: "unlinkProjectChannel", projectId: p.id, projectName: p.name })
                    }
                    onLink={() =>
                      setLinkChannelDialog({
                        projectId: p.id,
                        projectName: p.name,
                        clientTeamId: null,
                        clientTeamName: null,
                      })
                    }
                  />
                ))}
                {data?.orphanEstimates.map((e) => (
                  <EstimateRow
                    key={`orphan-est-${e.id}`}
                    estimate={e}
                    navigate={setLocation}
                    onUnlink={() =>
                      setPending({ type: "unlinkEstimateChannel", estimateId: e.id, estimateName: e.name })
                    }
                  />
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Unlink</AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.type === "unlinkClientTeam" && (
                <>This will unlink the Microsoft Team from <strong>{pending.clientName}</strong>. The Team in
                Microsoft 365 will not be deleted — only the Constellation link is removed. You can re-link or
                re-create it afterwards.</>
              )}
              {pending?.type === "unlinkProjectChannel" && (
                <>This will remove the channel link from project <strong>{pending.projectName}</strong>. The
                channel itself remains in Teams. You can re-create a channel connection from the project page.</>
              )}
              {pending?.type === "unlinkEstimateChannel" && (
                <>This will remove the channel link from estimate <strong>{pending.estimateName}</strong>. The
                channel itself remains in Teams. You can re-create a channel connection from the estimate page.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-teams-links-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmAction} data-testid="button-teams-links-confirm-unlink">
              Unlink
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {linkTeamDialog && (
        <LinkTeamDialog
          clientId={linkTeamDialog.clientId}
          clientName={linkTeamDialog.clientName}
          onClose={() => setLinkTeamDialog(null)}
          onLinked={() => {
            setLinkTeamDialog(null);
            invalidate();
          }}
        />
      )}

      {linkChannelDialog && (
        <LinkProjectChannelDialog
          projectId={linkChannelDialog.projectId}
          projectName={linkChannelDialog.projectName}
          clientTeamId={linkChannelDialog.clientTeamId}
          clientTeamName={linkChannelDialog.clientTeamName}
          onClose={() => setLinkChannelDialog(null)}
          onLinked={() => {
            setLinkChannelDialog(null);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="border rounded-md p-3 bg-muted/30">
      <div className="text-xs uppercase text-muted-foreground tracking-wide">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}

function ClientGroupRow({
  group,
  navigate,
  onUnlinkTeam,
  onLinkTeam,
  onUnlinkProjectChannel,
  onLinkProjectChannel,
  onUnlinkEstimateChannel,
}: {
  group: ClientGroup;
  navigate: (to: string) => void;
  onUnlinkTeam: () => void;
  onLinkTeam: () => void;
  onUnlinkProjectChannel: (p: ProjectLink) => void;
  onLinkProjectChannel: (p: ProjectLink) => void;
  onUnlinkEstimateChannel: (e: EstimateLink) => void;
}) {
  const hasAnyLink =
    !!group.team ||
    group.projects.some((p) => p.channelId) ||
    group.estimates.some((e) => e.channelId);

  return (
    <AccordionItem value={group.clientId} className="border-b last:border-b-0">
      <AccordionTrigger className="px-4 hover:no-underline" data-testid={`row-client-${group.clientId}`}>
        <div className="flex items-center justify-between gap-3 w-full pr-2">
          <div className="flex items-center gap-2 text-left">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{group.clientName}</span>
            {group.team ? (
              <Badge variant="secondary" className="ml-2 gap-1">
                <Link2 className="h-3 w-3" />
                Team linked
              </Badge>
            ) : (
              <Badge variant="outline" className="ml-2 gap-1 text-muted-foreground">
                <Link2Off className="h-3 w-3" />
                No Team
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{group.projects.length} proj</span>
            <span>•</span>
            <span>{group.estimates.length} est</span>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-4 pb-4 pt-0 space-y-4">
        {/* Team row */}
        <div className="flex flex-wrap items-center gap-2 p-3 rounded-md bg-muted/40">
          <MicrosoftTeamsIcon className="h-4 w-4" />
          <span className="text-sm font-medium flex-1 min-w-[180px]">
            {group.team ? (
              <>
                {group.team.teamName || <span className="text-muted-foreground italic">Unnamed Team</span>}
                {group.team.source === "legacy" && (
                  <Badge variant="outline" className="ml-2 text-[10px]">legacy</Badge>
                )}
              </>
            ) : (
              <span className="text-muted-foreground italic">No Team linked to this client</span>
            )}
          </span>
          <div className="flex items-center gap-2">
            {group.team?.teamWebUrl && (
              <Button
                asChild
                variant="outline"
                size="sm"
                data-testid={`link-open-team-${group.clientId}`}
              >
                <a href={group.team.teamWebUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open
                </a>
              </Button>
            )}
            {group.team ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onUnlinkTeam}
                data-testid={`button-unlink-team-${group.clientId}`}
              >
                <Unlink className="h-3.5 w-3.5 mr-1" /> Unlink
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={onLinkTeam}
                data-testid={`button-link-team-${group.clientId}`}
              >
                <Link2 className="h-3.5 w-3.5 mr-1" /> Link Team
              </Button>
            )}
          </div>
        </div>

        {/* Projects */}
        <div>
          <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Projects ({group.projects.length})
          </h5>
          {group.projects.length === 0 ? (
            <div className="text-xs text-muted-foreground italic py-2">No projects for this client.</div>
          ) : (
            <div className="space-y-1">
              {group.projects.map((p) => (
                <ProjectRow
                  key={p.id}
                  project={p}
                  navigate={navigate}
                  onUnlink={() => onUnlinkProjectChannel(p)}
                  onLink={() => onLinkProjectChannel(p)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Estimates */}
        <div>
          <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Estimates ({group.estimates.length})
          </h5>
          {group.estimates.length === 0 ? (
            <div className="text-xs text-muted-foreground italic py-2">No estimates for this client.</div>
          ) : (
            <div className="space-y-1">
              {group.estimates.map((e) => (
                <EstimateRow
                  key={e.id}
                  estimate={e}
                  navigate={navigate}
                  onUnlink={() => onUnlinkEstimateChannel(e)}
                />
              ))}
            </div>
          )}
        </div>

        {!hasAnyLink && (
          <div className="text-xs text-muted-foreground italic">
            No Teams connections yet for this client.
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}

function ProjectRow({
  project,
  navigate,
  onUnlink,
  onLink,
}: {
  project: ProjectLink;
  navigate: (to: string) => void;
  onUnlink: () => void;
  onLink: () => void;
}) {
  const linked = !!project.channelId;
  return (
    <div className="flex flex-wrap items-center gap-2 p-2 rounded border bg-background">
      <FolderOpen className="h-4 w-4 text-muted-foreground" />
      <div className="flex-1 min-w-[160px]">
        <div className="text-sm font-medium">
          {project.name}
          {project.code && (
            <span className="text-xs text-muted-foreground ml-2">({project.code})</span>
          )}
        </div>
        {linked ? (
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Link2 className="h-3 w-3" />
            Channel: {project.channelName || project.channelId}
            {project.plannerPlanId && <span className="ml-2">• Planner plan linked</span>}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground italic">No channel linked</div>
        )}
      </div>
      <div className="flex items-center gap-1">
        {linked && project.channelWebUrl && (
          <Button asChild variant="ghost" size="sm" data-testid={`link-open-project-channel-${project.id}`}>
            <a href={project.channelWebUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open
            </a>
          </Button>
        )}
        {linked && (
          <Button variant="ghost" size="sm" onClick={onUnlink} data-testid={`button-unlink-project-${project.id}`}>
            <Unlink className="h-3.5 w-3.5 mr-1" /> Unlink
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onLink}
          data-testid={`button-relink-project-${project.id}`}
        >
          <RefreshCw className="h-3.5 w-3.5 mr-1" />
          {linked ? "Re-link" : "Link"}
        </Button>
      </div>
    </div>
  );
}

function EstimateRow({
  estimate,
  navigate,
  onUnlink,
}: {
  estimate: EstimateLink;
  navigate: (to: string) => void;
  onUnlink: () => void;
}) {
  const linked = !!estimate.channelId;
  return (
    <div className="flex flex-wrap items-center gap-2 p-2 rounded border bg-background">
      <FileText className="h-4 w-4 text-muted-foreground" />
      <div className="flex-1 min-w-[160px]">
        <div className="text-sm font-medium">{estimate.name}</div>
        {linked ? (
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Link2 className="h-3 w-3" />
            {estimate.teamName ? `${estimate.teamName} / ` : ""}
            {estimate.channelName || estimate.channelId}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground italic">No channel linked</div>
        )}
      </div>
      <div className="flex items-center gap-1">
        {linked && estimate.channelWebUrl && (
          <Button asChild variant="ghost" size="sm" data-testid={`link-open-estimate-channel-${estimate.id}`}>
            <a href={estimate.channelWebUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open
            </a>
          </Button>
        )}
        {linked && (
          <Button variant="ghost" size="sm" onClick={onUnlink} data-testid={`button-unlink-estimate-${estimate.id}`}>
            <Unlink className="h-3.5 w-3.5 mr-1" /> Unlink
          </Button>
        )}
      </div>
    </div>
  );
}

function LinkTeamDialog({
  clientId,
  clientName,
  onClose,
  onLinked,
}: {
  clientId: string;
  clientName: string;
  onClose: () => void;
  onLinked: () => void;
}) {
  const { toast } = useToast();
  const [teamSearch, setTeamSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedTeam, setSelectedTeam] = useState<{ id: string; displayName: string } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(teamSearch), 400);
    return () => clearTimeout(t);
  }, [teamSearch]);

  const queryKey = debouncedSearch.trim()
    ? [`/api/planner/teams?search=${encodeURIComponent(debouncedSearch.trim())}`]
    : ["/api/planner/teams"];

  const { data: teamsResponse, isLoading: teamsLoading } = useQuery<{ teams: { id: string; displayName: string }[]; nextLink?: string }>({
    queryKey,
  });

  const teams = teamsResponse?.teams ?? [];

  const linkMutation = useMutation({
    mutationFn: (team: { id: string; displayName: string }) =>
      apiRequest(`/api/clients/${clientId}/microsoft-team`, {
        method: "POST",
        body: JSON.stringify({ teamId: team.id, teamName: team.displayName }),
      }),
    onSuccess: () => {
      toast({ title: `Team linked to ${clientName}` });
      onLinked();
    },
    onError: (e: Error) =>
      toast({ title: "Failed to link team", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Link Microsoft Team</DialogTitle>
          <DialogDescription>
            Select an existing Microsoft Team to link to <strong>{clientName}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search teams…"
              value={teamSearch}
              onChange={(e) => setTeamSearch(e.target.value)}
              autoFocus
            />
          </div>

          <div className="border rounded-md max-h-60 overflow-y-auto">
            {teamsLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground text-sm gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {debouncedSearch ? "Searching…" : "Loading teams…"}
              </div>
            ) : teams.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                {teamSearch ? "No teams match your search." : "No teams available."}
              </div>
            ) : (
              teams.map((team) => (
                <button
                  key={team.id}
                  type="button"
                  className={`w-full text-left flex items-center gap-3 p-3 border-b last:border-b-0 hover:bg-muted/50 transition-colors ${
                    selectedTeam?.id === team.id ? "bg-primary/10" : ""
                  }`}
                  onClick={() => setSelectedTeam(team)}
                >
                  <MicrosoftTeamsIcon className="h-4 w-4 shrink-0" />
                  <span className="text-sm">{team.displayName}</span>
                  {selectedTeam?.id === team.id && (
                    <Badge variant="secondary" className="ml-auto text-xs">Selected</Badge>
                  )}
                </button>
              ))
            )}
          </div>
          {!debouncedSearch && teams.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Showing first {teams.length} teams — type to search all teams in your tenant.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={linkMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => selectedTeam && linkMutation.mutate(selectedTeam)}
            disabled={!selectedTeam || linkMutation.isPending}
          >
            {linkMutation.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Linking…</>
            ) : (
              "Link Team"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LinkProjectChannelDialog({
  projectId,
  projectName,
  clientTeamId,
  clientTeamName,
  onClose,
  onLinked,
}: {
  projectId: string;
  projectName: string;
  clientTeamId: string | null;
  clientTeamName: string | null;
  onClose: () => void;
  onLinked: () => void;
}) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"existing" | "create">("existing");

  // Shared team state
  const [teamSearch, setTeamSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedTeam, setSelectedTeam] = useState<{ id: string; displayName: string } | null>(null);
  const resolvedTeamId = clientTeamId ?? selectedTeam?.id ?? null;
  const resolvedTeamName = clientTeamName ?? selectedTeam?.displayName ?? null;

  // Create-mode state
  const [channelName, setChannelName] = useState(projectName);

  // Existing-mode state
  const [selectedChannel, setSelectedChannel] = useState<{ id: string; displayName: string; webUrl?: string } | null>(null);

  const needsTeamPicker = !clientTeamId;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(teamSearch), 400);
    return () => clearTimeout(t);
  }, [teamSearch]);

  // Teams query (for when no client team is set)
  const teamsQueryKey = debouncedSearch.trim()
    ? [`/api/planner/teams?search=${encodeURIComponent(debouncedSearch.trim())}`]
    : ["/api/planner/teams"];

  const { data: teamsResponse, isLoading: teamsLoading } = useQuery<{ teams: { id: string; displayName: string }[]; nextLink?: string }>({
    queryKey: teamsQueryKey,
    enabled: needsTeamPicker,
  });
  const teams = teamsResponse?.teams ?? [];

  // Channels query — only runs when in existing mode and a team is resolved
  const { data: channelsData, isLoading: channelsLoading } = useQuery<{ id: string; displayName: string; webUrl?: string; membershipType?: string }[]>({
    queryKey: resolvedTeamId ? [`/api/planner/teams/${resolvedTeamId}/channels`] : ["no-team"],
    enabled: mode === "existing" && !!resolvedTeamId,
  });
  const channels = channelsData ?? [];

  // Reset channel selection when team changes
  useEffect(() => { setSelectedChannel(null); }, [resolvedTeamId]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!resolvedTeamId) throw new Error("No team selected");
      await apiRequest(`/api/planner/teams/${resolvedTeamId}/channels`, {
        method: "POST",
        body: JSON.stringify({ displayName: channelName.trim() || projectName, projectId, projectName }),
      });
    },
    onSuccess: () => { toast({ title: `Channel created and linked to ${projectName}` }); onLinked(); },
    onError: (e: Error) => toast({ title: "Failed to create channel", description: e.message, variant: "destructive" }),
  });

  const linkExistingMutation = useMutation({
    mutationFn: async () => {
      if (!selectedChannel) throw new Error("No channel selected");
      await apiRequest(`/api/projects/${projectId}/channel`, {
        method: "POST",
        body: JSON.stringify({
          teamId: resolvedTeamId,
          channelId: selectedChannel.id,
          channelName: selectedChannel.displayName,
          channelWebUrl: selectedChannel.webUrl ?? null,
        }),
      });
    },
    onSuccess: () => { toast({ title: `Linked "${selectedChannel?.displayName}" to ${projectName}` }); onLinked(); },
    onError: (e: Error) => toast({ title: "Failed to link channel", description: e.message, variant: "destructive" }),
  });

  const isPending = createMutation.isPending || linkExistingMutation.isPending;
  const canSubmit = mode === "existing"
    ? !!selectedChannel && !isPending
    : !!resolvedTeamId && channelName.trim().length > 0 && !isPending;

  const TeamPicker = needsTeamPicker ? (
    <div className="space-y-2">
      <Label className="text-sm font-medium">Select a Team</Label>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search teams…" value={teamSearch} onChange={(e) => setTeamSearch(e.target.value)} />
      </div>
      <div className="border rounded-md max-h-36 overflow-y-auto">
        {teamsLoading ? (
          <div className="flex items-center justify-center py-5 text-muted-foreground text-sm gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />{debouncedSearch ? "Searching…" : "Loading teams…"}
          </div>
        ) : teams.length === 0 ? (
          <div className="text-center py-5 text-muted-foreground text-sm">{teamSearch ? "No teams match." : "No teams available."}</div>
        ) : teams.map((team) => (
          <button key={team.id} type="button"
            className={`w-full text-left flex items-center gap-3 p-2.5 border-b last:border-b-0 hover:bg-muted/50 transition-colors text-sm ${selectedTeam?.id === team.id ? "bg-primary/10" : ""}`}
            onClick={() => setSelectedTeam(team)}>
            <MicrosoftTeamsIcon className="h-4 w-4 shrink-0" />{team.displayName}
            {selectedTeam?.id === team.id && <Badge variant="secondary" className="ml-auto text-xs">Selected</Badge>}
          </button>
        ))}
      </div>
      {!debouncedSearch && teams.length > 0 && (
        <p className="text-xs text-muted-foreground">Showing first {teams.length} — type to search all teams.</p>
      )}
    </div>
  ) : (
    <div className="flex items-center gap-2 p-2 rounded-md bg-muted/40 text-sm">
      <MicrosoftTeamsIcon className="h-4 w-4 shrink-0" />
      <span className="text-muted-foreground">Team:</span>
      <span className="font-medium">{resolvedTeamName || resolvedTeamId}</span>
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Teams Channel — {projectName}</DialogTitle>
          <DialogDescription>
            Link a Microsoft Teams channel to this project.
          </DialogDescription>
        </DialogHeader>

        {/* Mode toggle */}
        <div className="flex gap-1 p-1 bg-muted rounded-md">
          <button type="button"
            className={`flex-1 text-sm py-1.5 rounded transition-colors font-medium ${mode === "existing" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setMode("existing")}>
            Link existing channel
          </button>
          <button type="button"
            className={`flex-1 text-sm py-1.5 rounded transition-colors font-medium ${mode === "create" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setMode("create")}>
            Create new channel
          </button>
        </div>

        <div className="space-y-3">
          {TeamPicker}

          {mode === "existing" ? (
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Select an existing channel</Label>
              <div className="border rounded-md max-h-48 overflow-y-auto">
                {!resolvedTeamId ? (
                  <div className="text-center py-6 text-muted-foreground text-sm italic">Select a team above first.</div>
                ) : channelsLoading ? (
                  <div className="flex items-center justify-center py-6 text-muted-foreground text-sm gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading channels…
                  </div>
                ) : channels.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground text-sm">No channels found.</div>
                ) : channels.map((ch) => (
                  <button key={ch.id} type="button"
                    className={`w-full text-left flex items-center gap-3 p-2.5 border-b last:border-b-0 hover:bg-muted/50 transition-colors text-sm ${selectedChannel?.id === ch.id ? "bg-primary/10" : ""}`}
                    onClick={() => setSelectedChannel(ch)}>
                    {ch.membershipType === "private" ? (
                      <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    ) : (
                      <span className="text-muted-foreground shrink-0">#</span>
                    )}
                    <span className="flex-1">{ch.displayName}</span>
                    {ch.membershipType === "private" && <Badge variant="outline" className="text-xs text-muted-foreground">Private</Badge>}
                    {selectedChannel?.id === ch.id && <Badge variant="secondary" className="text-xs">Selected</Badge>}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="channel-name">New channel name</Label>
              <Input
                id="channel-name"
                value={channelName}
                onChange={(e) => setChannelName(e.target.value)}
                placeholder="Channel name…"
                autoFocus={!!clientTeamId}
              />
            </div>
          )}
        </div>

                <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button onClick={() => mode === "existing" ? linkExistingMutation.mutate() : createMutation.mutate()} disabled={!canSubmit}>
            {isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{mode === "existing" ? "Linking..." : "Creating..."}</>
            ) : (
              mode === "existing" ? "Link Channel" : "Create & Link Channel"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
