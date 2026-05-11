import { useState, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  FileText,
  FolderOpen,
  DollarSign,
  Clock,
  AlertCircle,
} from "lucide-react";
import { SlippageBadge } from "@/components/dashboard/slippage-badge";
import { useAuth } from "@/hooks/use-auth";
import type { PortfolioSlippageSummary } from "@/lib/types";
import {
  addMonths,
  startOfQuarter,
  endOfQuarter,
  startOfMonth,
  endOfMonth,
  differenceInDays,
  format,
  isWithinInterval,
  isBefore,
  isAfter,
  addQuarters,
  subQuarters,
  parseISO,
} from "date-fns";

type TimelineFilter = "active" | "pending" | "both";
type TimelineScale = "2q" | "4q";

function safeParse(dateStr: string | null): Date | null {
  if (!dateStr) return null;
  try {
    const d = parseISO(dateStr);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

interface TimelineItem {
  type: "project" | "estimate";
  id: string;
  name: string;
  code: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  projectedEndDate?: string | null;
  clientId: string;
  clientName: string;
  budget: number | null;
  commercialScheme?: string;
  durationWeeks?: number;
  estimateDate?: string;
}

interface TimelineClient {
  id: string;
  name: string;
  items: TimelineItem[];
}

interface TimelineData {
  clients: TimelineClient[];
}

export function PortfolioTimeline() {
  const [, navigate] = useLocation();
  const { hasAnyRole } = useAuth();
  const canViewSlippage = hasAnyRole(["admin", "billing-admin", "pm", "portfolio-manager", "executive"]);
  const [filter, setFilter] = useState<TimelineFilter>("active");
  const [scale, setScale] = useState<TimelineScale>("2q");
  const [viewStart, setViewStart] = useState(() => startOfQuarter(new Date()));
  const scrollRef = useRef<HTMLDivElement>(null);

  const monthCount = scale === "2q" ? 6 : 12;
  const viewEnd = addMonths(viewStart, monthCount);

  const { data, isLoading } = useQuery<TimelineData>({
    queryKey: [`/api/portfolio/timeline?filter=${filter}`],
  });

  const { data: slippageData } = useQuery<PortfolioSlippageSummary>({
    queryKey: ["/api/portfolio/slippage"],
    staleTime: 5 * 60 * 1000,
    enabled: canViewSlippage && (filter === "active" || filter === "both"),
  });

  const slippageMap = useMemo(() => {
    const m = new Map<string, { level: PortfolioSlippageSummary["projects"][0]["slippageLevel"]; score: number; projectedSlipDays: number }>();
    slippageData?.projects.forEach((p) => {
      m.set(p.projectId, { level: p.slippageLevel, score: p.slippageScore, projectedSlipDays: p.projectedSlipDays });
    });
    return m;
  }, [slippageData]);

  const months = useMemo(() => {
    const result = [];
    let current = startOfMonth(viewStart);
    while (isBefore(current, viewEnd)) {
      result.push({
        date: current,
        label: format(current, "MMM"),
        year: format(current, "yyyy"),
        start: current,
        end: endOfMonth(current),
      });
      current = addMonths(current, 1);
    }
    return result;
  }, [viewStart, viewEnd]);

  const quarters = useMemo(() => {
    const result: { label: string; months: number }[] = [];
    let current = startOfQuarter(viewStart);
    while (isBefore(current, viewEnd)) {
      const qEnd = endOfQuarter(current);
      const monthsInQ = months.filter(
        (m) =>
          !isBefore(m.date, current) && !isAfter(m.date, qEnd)
      ).length;
      if (monthsInQ > 0) {
        const qNum = Math.ceil((current.getMonth() + 1) / 3);
        result.push({
          label: `Q${qNum} ${format(current, "yyyy")}`,
          months: monthsInQ,
        });
      }
      current = addQuarters(current, 1);
    }
    return result;
  }, [viewStart, viewEnd, months]);

  const totalDays = differenceInDays(viewEnd, viewStart);

  const getBarStyle = (item: TimelineItem) => {
    const itemStart = safeParse(item.startDate);
    if (!itemStart) return null;

    let itemEnd: Date;
    const parsedEnd = safeParse(item.endDate);
    const parsedProjected = safeParse(item.projectedEndDate ?? null);
    const effectiveEnd = parsedEnd || parsedProjected;

    if (effectiveEnd) {
      itemEnd = effectiveEnd;
    } else if (item.type === "project") {
      itemEnd = viewEnd;
    } else {
      return null;
    }

    const clampedStart = isBefore(itemStart, viewStart) ? viewStart : itemStart;
    const clampedEnd = isAfter(itemEnd, viewEnd) ? viewEnd : itemEnd;

    if (isAfter(clampedStart, viewEnd) || isBefore(clampedEnd, viewStart)) {
      return null;
    }

    const leftDays = differenceInDays(clampedStart, viewStart);
    const widthDays = differenceInDays(clampedEnd, clampedStart);

    const left = (leftDays / totalDays) * 100;
    const width = Math.max((widthDays / totalDays) * 100, 1);

    const extendsLeft = isBefore(itemStart, viewStart);
    const extendsRight = effectiveEnd ? isAfter(effectiveEnd, viewEnd) : true;

    return { left: `${left}%`, width: `${width}%`, extendsLeft, extendsRight };
  };

  const getBarColor = (item: TimelineItem) => {
    if (item.type === "estimate") {
      if (item.status === "approved") {
        return "bg-amber-500/80 dark:bg-amber-600/80 border-amber-600 dark:border-amber-500";
      }
      if (item.status === "final" || item.status === "sent") {
        return "bg-amber-400/60 dark:bg-amber-500/60 border-amber-500 dark:border-amber-400 border-dashed";
      }
      return "bg-amber-300/50 dark:bg-amber-400/50 border-amber-400 dark:border-amber-300 border-dashed";
    }
    if (item.status === "on-hold") {
      return "bg-gray-400/80 dark:bg-gray-500/80 border-gray-500 dark:border-gray-400";
    }
    // Apply slippage-aware border for active projects
    if (item.type === "project") {
      const slip = slippageMap.get(item.id);
      if (slip) {
        if (slip.level === "critical") {
          return "bg-blue-500/80 dark:bg-blue-600/80 border-red-500 border-2";
        }
        if (slip.level === "at-risk") {
          return "bg-blue-500/80 dark:bg-blue-600/80 border-orange-400 border-2";
        }
        if (slip.level === "watch") {
          return "bg-blue-500/80 dark:bg-blue-600/80 border-amber-400 border-2";
        }
      }
    }
    if (item.projectedEndDate) {
      return "bg-blue-500/80 dark:bg-blue-600/80 border-blue-600 dark:border-blue-500 border-dashed";
    }
    return "bg-blue-500/80 dark:bg-blue-600/80 border-blue-600 dark:border-blue-500";
  };

  const navigateTimeline = (direction: "left" | "right") => {
    const shift = scale === "2q" ? 3 : 6;
    setViewStart((prev) =>
      direction === "left"
        ? subQuarters(prev, shift / 3)
        : addQuarters(prev, shift / 3)
    );
  };

  const goToToday = () => {
    setViewStart(startOfQuarter(new Date()));
  };

  const formatCurrency = (amount: number | null) => {
    if (amount === null || amount === undefined) return "-";
    return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  };

  const clientLabelWidth = "w-[200px] min-w-[200px]";

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <Skeleton className="h-9 w-32" />
              <Skeleton className="h-9 w-32" />
              <Skeleton className="h-9 w-24" />
            </div>
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const clients = data?.clients || [];
  const totalItems = clients.reduce((sum, c) => sum + c.items.length, 0);
  const itemsWithDates = clients.reduce(
    (sum, c) => sum + c.items.filter((i) => i.startDate).length,
    0
  );
  const itemsWithoutDates = totalItems - itemsWithDates;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={filter} onValueChange={(v) => setFilter(v as TimelineFilter)}>
          <SelectTrigger className="w-[180px]" data-testid="timeline-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active Projects</SelectItem>
            <SelectItem value="pending">Estimates (Pipeline)</SelectItem>
            <SelectItem value="both">Both</SelectItem>
          </SelectContent>
        </Select>

        <Select value={scale} onValueChange={(v) => setScale(v as TimelineScale)}>
          <SelectTrigger className="w-[140px]" data-testid="timeline-scale">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="2q">2 Quarters</SelectItem>
            <SelectItem value="4q">4 Quarters</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            onClick={() => navigateTimeline("left")}
            data-testid="timeline-prev"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={goToToday} data-testid="timeline-today">
            Today
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => navigateTimeline("right")}
            data-testid="timeline-next"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2 ml-auto text-sm text-muted-foreground flex-wrap">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-blue-500" />
            <span>Project</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-amber-500" />
            <span>Approved</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-amber-300/70 border border-dashed border-amber-400" />
            <span>Draft/Final</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-gray-400" />
            <span>On Hold</span>
          </div>
        </div>
      </div>

      {/* Items without dates warning */}
      {itemsWithoutDates > 0 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 px-3 py-2 rounded-md">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>
            {itemsWithoutDates} {itemsWithoutDates === 1 ? "item has" : "items have"} no
            start date and {itemsWithoutDates === 1 ? "is" : "are"} not shown on the timeline.
          </span>
        </div>
      )}

      {/* Timeline */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto" ref={scrollRef}>
          <div className="min-w-[800px]">
            {/* Quarter headers */}
            <div className="flex border-b bg-muted/30">
              <div className={`${clientLabelWidth} shrink-0 px-3 py-2 border-r font-medium text-sm flex items-center`}>
                Client / Project
              </div>
              <div className="flex-1 flex">
                {quarters.map((q, i) => (
                  <div
                    key={i}
                    className="text-center py-1.5 text-xs font-semibold text-muted-foreground border-r last:border-r-0 uppercase tracking-wide"
                    style={{ width: `${(q.months / monthCount) * 100}%` }}
                  >
                    {q.label}
                  </div>
                ))}
              </div>
            </div>

            {/* Month headers */}
            <div className="flex border-b bg-muted/10">
              <div className={`${clientLabelWidth} shrink-0 border-r`} />
              <div className="flex-1 flex">
                {months.map((m, i) => {
                  const isCurrentMonth =
                    format(new Date(), "yyyy-MM") === format(m.date, "yyyy-MM");
                  return (
                    <div
                      key={i}
                      className={`text-center py-1 text-xs border-r last:border-r-0 ${
                        isCurrentMonth
                          ? "bg-blue-50 dark:bg-blue-950/30 font-semibold text-blue-700 dark:text-blue-400"
                          : "text-muted-foreground"
                      }`}
                      style={{ width: `${100 / monthCount}%` }}
                    >
                      {m.label}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Today indicator line position */}
            {(() => {
              const today = new Date();
              if (isBefore(today, viewStart) || isAfter(today, viewEnd)) return null;
              const todayOffset = (differenceInDays(today, viewStart) / totalDays) * 100;
              return null; // We'll render the line inside the rows
            })()}

            {/* Client groups */}
            {clients.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <FolderOpen className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="text-lg font-medium">No items to display</p>
                <p className="text-sm mt-1">
                  {filter === "active"
                    ? "No active projects found."
                    : filter === "pending"
                    ? "No estimates in the pipeline."
                    : "No active projects or pipeline estimates found."}
                </p>
              </div>
            ) : (
              clients.map((client) => {
                const visibleItems = client.items.filter((item) => {
                  const barStyle = getBarStyle(item);
                  return barStyle !== null || !item.startDate;
                });

                return (
                  <div key={client.id} className="border-b last:border-b-0">
                    {/* Client header */}
                    <div className="flex bg-muted/20 hover:bg-muted/30 transition-colors">
                      <div
                        className={`${clientLabelWidth} shrink-0 px-3 py-2 border-r flex items-center gap-2`}
                      >
                        <span className="font-semibold text-sm truncate">{client.name}</span>
                        <Badge variant="secondary" className="text-xs shrink-0">
                          {client.items.length}
                        </Badge>
                      </div>
                      <div className="flex-1 relative">
                        {/* Month grid lines */}
                        <div className="absolute inset-0 flex pointer-events-none">
                          {months.map((_, i) => (
                            <div
                              key={i}
                              className="border-r border-dashed border-muted-foreground/10 last:border-r-0"
                              style={{ width: `${100 / monthCount}%` }}
                            />
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Project/Estimate bars */}
                    {client.items.map((item) => {
                      const barStyle = getBarStyle(item);

                      return (
                        <div
                          key={`${item.type}-${item.id}`}
                          className="flex hover:bg-accent/30 transition-colors group"
                        >
                          {/* Item label */}
                          <div
                            className={`${clientLabelWidth} shrink-0 px-3 py-2 border-r flex items-center gap-2 cursor-pointer`}
                            onClick={() => {
                              if (item.type === "project") {
                                navigate(`/projects/${item.id}`);
                              }
                            }}
                          >
                            {item.type === "project" ? (
                              <FolderOpen className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                            ) : (
                              <FileText className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                            )}
                            <span className="text-sm truncate group-hover:text-primary transition-colors">
                              {item.code ? `${item.code} - ` : ""}
                              {item.name}
                            </span>
                          </div>

                          {/* Timeline area */}
                          <div className="flex-1 relative py-1.5">
                            {/* Month grid lines */}
                            <div className="absolute inset-0 flex pointer-events-none">
                              {months.map((_, i) => (
                                <div
                                  key={i}
                                  className="border-r border-dashed border-muted-foreground/10 last:border-r-0"
                                  style={{ width: `${100 / monthCount}%` }}
                                />
                              ))}
                            </div>

                            {/* Today line */}
                            {(() => {
                              const today = new Date();
                              if (
                                isBefore(today, viewStart) ||
                                isAfter(today, viewEnd)
                              )
                                return null;
                              const todayOffset =
                                (differenceInDays(today, viewStart) / totalDays) * 100;
                              return (
                                <div
                                  className="absolute top-0 bottom-0 w-px bg-red-500/60 z-10 pointer-events-none"
                                  style={{ left: `${todayOffset}%` }}
                                />
                              );
                            })()}

                            {/* Bar */}
                            {barStyle ? (
                              <HoverCard openDelay={200} closeDelay={100}>
                                <HoverCardTrigger asChild>
                                  <div
                                    className={`absolute top-1.5 h-6 ${getBarColor(item)} border cursor-pointer transition-all hover:brightness-110 hover:shadow-md z-20 ${
                                      barStyle.extendsLeft ? "rounded-l-none" : "rounded-l-md"
                                    } ${
                                      barStyle.extendsRight ? "rounded-r-none" : "rounded-r-md"
                                    }`}
                                    style={{
                                      left: barStyle.left,
                                      width: barStyle.width,
                                      minWidth: "8px",
                                    }}
                                    onClick={() => {
                                      if (item.type === "project") {
                                        navigate(`/projects/${item.id}`);
                                      }
                                    }}
                                    data-testid={`timeline-bar-${item.type}-${item.id}`}
                                  >
                                    <div className="px-2 h-full flex items-center overflow-hidden">
                                      <span className="text-[11px] font-medium text-white truncate leading-none">
                                        {item.name}
                                      </span>
                                    </div>
                                  </div>
                                </HoverCardTrigger>
                                <HoverCardContent
                                  className="w-72"
                                  side="top"
                                  align="start"
                                >
                                  <div className="space-y-2">
                                    <div className="flex items-center gap-2">
                                      {item.type === "project" ? (
                                        <FolderOpen className="h-4 w-4 text-blue-500" />
                                      ) : (
                                        <FileText className="h-4 w-4 text-amber-500" />
                                      )}
                                      <span className="font-semibold text-sm">
                                        {item.name}
                                      </span>
                                    </div>

                                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                                      <div className="text-muted-foreground">Type</div>
                                      <div className="capitalize">
                                        <Badge
                                          variant={
                                            item.type === "project"
                                              ? "default"
                                              : "secondary"
                                          }
                                          className="text-xs"
                                        >
                                          {item.type}
                                        </Badge>
                                      </div>

                                      <div className="text-muted-foreground">Client</div>
                                      <div>{item.clientName}</div>

                                      <div className="text-muted-foreground">Status</div>
                                      <div className="capitalize">{item.status}</div>

                                      {item.type === "project" && slippageMap.has(item.id) && (() => {
                                        const slip = slippageMap.get(item.id)!;
                                        return (
                                          <>
                                            <div className="text-muted-foreground">Schedule</div>
                                            <div>
                                              <SlippageBadge level={slip.level} score={slip.score} showScore />
                                              {slip.projectedSlipDays > 0 && (
                                                <span className="ml-1 text-red-600 text-xs">+{slip.projectedSlipDays}d slip</span>
                                              )}
                                            </div>
                                          </>
                                        );
                                      })()}

                                      {item.code && (
                                        <>
                                          <div className="text-muted-foreground">Code</div>
                                          <div>{item.code}</div>
                                        </>
                                      )}

                                      <div className="text-muted-foreground">Start</div>
                                      <div>
                                        {safeParse(item.startDate)
                                          ? format(safeParse(item.startDate)!, "MMM d, yyyy")
                                          : "-"}
                                      </div>

                                      <div className="text-muted-foreground">End</div>
                                      <div>
                                        {safeParse(item.endDate)
                                          ? format(safeParse(item.endDate)!, "MMM d, yyyy")
                                          : item.projectedEndDate
                                          ? <>
                                              {format(safeParse(item.projectedEndDate)!, "MMM d, yyyy")}
                                              <span className="text-muted-foreground ml-1 italic">(projected)</span>
                                            </>
                                          : item.type === "project"
                                          ? "Ongoing"
                                          : "-"}
                                      </div>

                                      {item.budget !== null && (
                                        <>
                                          <div className="text-muted-foreground">
                                            {item.type === "project" ? "SOW Value" : "Estimate"}
                                          </div>
                                          <div className="font-medium">
                                            {formatCurrency(item.budget)}
                                          </div>
                                        </>
                                      )}

                                      {item.durationWeeks && (
                                        <>
                                          <div className="text-muted-foreground">Duration</div>
                                          <div>
                                            {item.durationWeeks}{" "}
                                            {item.durationWeeks === 1 ? "week" : "weeks"}
                                          </div>
                                        </>
                                      )}

                                      {item.commercialScheme && (
                                        <>
                                          <div className="text-muted-foreground">Type</div>
                                          <div className="uppercase text-xs">
                                            {item.commercialScheme === "tm"
                                              ? "T&M"
                                              : item.commercialScheme}
                                          </div>
                                        </>
                                      )}
                                    </div>

                                    <div className="pt-1 border-t text-xs text-muted-foreground">
                                      Click to view details
                                    </div>
                                  </div>
                                </HoverCardContent>
                              </HoverCard>
                            ) : !item.startDate ? (
                              <div className="absolute inset-x-0 top-1.5 h-6 flex items-center justify-center">
                                <span className="text-xs text-muted-foreground italic">
                                  No {item.type === "estimate" ? "potential start" : "start"} date set
                                </span>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
