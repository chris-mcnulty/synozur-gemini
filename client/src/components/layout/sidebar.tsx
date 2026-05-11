import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Link, useLocation } from "wouter";
import { 
  ChartLine, 
  FolderOpen, 
  Clock, 
  Receipt, 
  FileText, 
  DollarSign, 
  Users,
  BarChart3,
  Settings,
  Building2,
  Info,
  Briefcase,
  Languages,
  Home,
  Calculator,
  Handshake,
  CreditCard,
  Banknote,
  Database,
  BookOpen,
  Shield,
  Crown,
  Package,
  Plane,
  Globe,
  CalendarClock,
  History,
  Map,
  GanttChart,
  ChevronRight,
  HelpCircle,
  ShieldAlert,
  Brain,
  LifeBuoy,
  ActivitySquare,
  Workflow,
  Network,
  Plug,
  TrendingUp,
  Bell,
  Wallet,
  ScrollText,
} from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "constellation-sidebar-sections-v2";

function SubGroupLabel({ label }: { label: string }) {
  return (
    <div className="px-3 pt-3 pb-1 first:pt-1">
      <span className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider">
        {label}
      </span>
    </div>
  );
}

interface SidebarItemProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  badge?: string;
  requiredRoles?: string[];
}

function SidebarItem({ href, icon, label, badge, requiredRoles }: SidebarItemProps) {
  const [location] = useLocation();
  const { hasAnyRole } = useAuth();
  
  const isActive = location === href;
  
  if (requiredRoles && !hasAnyRole(requiredRoles)) {
    return null;
  }

  return (
    <Link 
      href={href}
      className={cn(
        "relative flex items-center space-x-3 px-3 py-2 rounded-md transition-all text-sm",
        isActive 
          ? 'border-l-2 border-primary bg-gradient-to-r from-primary/15 to-transparent text-accent-foreground font-medium sidebar-active-item'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent/50 border-l-2 border-transparent sidebar-hover-item'
      )}
      data-testid={`link-${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <div className="w-4 h-4 shrink-0">{icon}</div>
      <span className="truncate">{label}</span>
      {badge && (
        <span className="ml-auto text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full">
          {badge}
        </span>
      )}
    </Link>
  );
}

interface CollapsibleSectionProps {
  id: string;
  title: string;
  children: React.ReactNode;
  isOpen: boolean;
  onToggle: (id: string) => void;
}

function CollapsibleSection({ id, title, children, isOpen, onToggle }: CollapsibleSectionProps) {
  return (
    <Collapsible open={isOpen} onOpenChange={() => onToggle(id)}>
      <CollapsibleTrigger className="flex items-center justify-between w-full pt-4 pb-2 group cursor-pointer">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider group-hover:text-foreground transition-colors">
          {title}
        </h3>
        <ChevronRight className={cn(
          "w-3.5 h-3.5 text-muted-foreground transition-transform duration-200",
          isOpen && "rotate-90"
        )} />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-1">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

interface SectionRoute {
  sectionId: string;
  paths: string[];
}

const sectionRoutes: SectionRoute[] = [
  { sectionId: "my-workspace", paths: ["/my-dashboard", "/my-assignments", "/my-projects", "/time", "/expenses", "/expense-reports", "/my-reimbursements", "/my-contractor-invoices", "/my-raidd", "/notifications", "/notifications/preferences"] },
  { sectionId: "portfolio", paths: ["/", "/dashboard", "/portfolio/timeline", "/portfolio/raidd", "/portfolio/schedule-health", "/reports", "/executive-narrative", "/projects", "/clients", "/resource-management", "/resource-planning", "/resource-planning/capacity", "/estimates", "/crm/deals"] },
  { sectionId: "financial", paths: ["/billing", "/invoice-report", "/client-revenue-report", "/expense-management", "/expense-approval", "/approvals/time", "/reimbursement-batches", "/contractor-invoices", "/rates"] },
  { sectionId: "administration", paths: ["/users", "/organization-settings", "/system-settings", "/admin/scheduled-jobs", "/admin/agent-card-health", "/admin/background-jobs", "/file-repository", "/admin/sharepoint", "/m365-integration", "/vocabulary", "/ai-grounding", "/ai-settings"] },
  { sectionId: "platform", paths: ["/platform/tenants", "/platform/service-plans", "/platform/users", "/platform/airports", "/platform/oconus", "/platform/grounding-docs"] },
  { sectionId: "payroll", paths: ["/payroll", "/payroll/employees", "/payroll/schedules", "/payroll/runs", "/payroll/gl", "/payroll/audit"] },
];

function getSectionForPath(path: string): string | null {
  for (const section of sectionRoutes) {
    if (section.paths.includes(path)) {
      return section.sectionId;
    }
    if (path !== "/" && section.paths.some(p => p !== "/" && path.startsWith(p))) {
      return section.sectionId;
    }
  }
  return null;
}

function loadSectionState(): Record<string, boolean> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return { "my-workspace": true };
}

function saveSectionState(state: Record<string, boolean>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

export function Sidebar() {
  const { hasAnyRole, isPlatformAdmin } = useAuth();
  const [location] = useLocation();
  
  const isManager = hasAnyRole(['admin', 'pm', 'portfolio-manager', 'executive']);
  const isFinanceRole = hasAnyRole(['admin', 'billing-admin']);
  const isAdmin = hasAnyRole(['admin']);

  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    const saved = loadSectionState();
    const activeSection = getSectionForPath(location);
    if (activeSection) {
      saved[activeSection] = true;
    }
    return saved;
  });

  useEffect(() => {
    const activeSection = getSectionForPath(location);
    if (activeSection && !openSections[activeSection]) {
      setOpenSections(prev => {
        const next = { ...prev, [activeSection]: true };
        saveSectionState(next);
        return next;
      });
    }
  }, [location]);

  const handleToggle = useCallback((id: string) => {
    setOpenSections(prev => {
      const next = { ...prev, [id]: !prev[id] };
      saveSectionState(next);
      return next;
    });
  }, []);
  
  return (
    <aside className="hidden lg:flex lg:flex-col w-64 bg-card border-r border-border h-[calc(100vh-73px)] sticky top-[73px]" data-testid="sidebar">
      <ScrollArea className="flex-1">
        <div className="px-4 py-2">
          <nav className="space-y-1">
            <CollapsibleSection
              id="my-workspace"
              title="My Workspace"
              isOpen={!!openSections["my-workspace"]}
              onToggle={handleToggle}
            >
              <SubGroupLabel label="Daily Work" />
              <SidebarItem href="/my-dashboard" icon={<Home />} label="My Dashboard" />
              <SidebarItem href="/my-assignments" icon={<Briefcase />} label="Assignments" />
              <SidebarItem href="/my-projects" icon={<FolderOpen />} label="My Projects" />
              <SubGroupLabel label="Time & Expenses" />
              <SidebarItem href="/time" icon={<Clock />} label="Timesheets" />
              <SidebarItem href="/expenses" icon={<Receipt />} label="Expenses" />
              <SidebarItem href="/expense-reports" icon={<FileText />} label="Expense Reports" />
              <SubGroupLabel label="Tracking" />
              <SidebarItem href="/my-reimbursements" icon={<Banknote />} label="My Reimbursements" />
              <SidebarItem href="/my-contractor-invoices" icon={<FileText />} label="My Contractor Invoices" />
              <SidebarItem href="/my-raidd" icon={<Shield />} label="My RAIDD" />
              <SubGroupLabel label="Notifications" />
              <SidebarItem href="/notifications" icon={<Bell />} label="Notifications" />
              <SidebarItem href="/notifications/preferences" icon={<Bell />} label="Notification Preferences" />
            </CollapsibleSection>
            
            {isManager && (
              <CollapsibleSection
                id="portfolio"
                title="Portfolio"
                isOpen={!!openSections["portfolio"]}
                onToggle={handleToggle}
              >
                <SubGroupLabel label="Overview" />
                <SidebarItem href="/" icon={<ChartLine />} label="Portfolio Dashboard" />
                <SidebarItem href="/portfolio/timeline" icon={<GanttChart />} label="Portfolio Timeline" />
                {hasAnyRole(["admin", "pm", "portfolio-manager", "executive"]) && (
                  <SidebarItem href="/portfolio/raidd" icon={<ShieldAlert />} label="Portfolio RAIDD" />
                )}
                {hasAnyRole(["admin", "billing-admin", "pm", "portfolio-manager", "executive"]) && (
                  <SidebarItem href="/portfolio/schedule-health" icon={<ActivitySquare />} label="Schedule Health" />
                )}
                <SidebarItem href="/reports" icon={<BarChart3 />} label="Reports" />
                <SidebarItem href="/executive-narrative" icon={<Brain />} label="Executive Narrative" requiredRoles={["admin", "pm", "portfolio-manager", "executive"]} />
                <SubGroupLabel label="Management" />
                <SidebarItem href="/projects" icon={<FolderOpen />} label="All Projects" />
                <SidebarItem href="/clients" icon={<Building2 />} label="Clients" />
                <SidebarItem href="/resource-management" icon={<Users />} label="Resources" />
                <SidebarItem href="/resource-planning" icon={<GanttChart />} label="Resource Planning" requiredRoles={["admin", "pm", "portfolio-manager", "executive"]} />
                <SidebarItem href="/resource-planning/capacity" icon={<TrendingUp />} label="Capacity Planning" requiredRoles={["admin", "pm", "portfolio-manager", "executive"]} />
                <SidebarItem href="/estimates" icon={<FileText />} label="Estimates" />
                <SubGroupLabel label="Pipeline" />
                <SidebarItem href="/crm/deals" icon={<Handshake />} label="CRM Deals" requiredRoles={["admin", "pm", "portfolio-manager"]} />
              </CollapsibleSection>
            )}
            
            {isFinanceRole && (
              <CollapsibleSection
                id="financial"
                title="Financial"
                isOpen={!!openSections["financial"]}
                onToggle={handleToggle}
              >
                <SubGroupLabel label="Billing" />
                <SidebarItem href="/billing" icon={<DollarSign />} label="Billing & Invoicing" />
                <SidebarItem href="/invoice-report" icon={<FileText />} label="Invoice Report" />
                <SidebarItem href="/client-revenue-report" icon={<Building2 />} label="Client Revenue" />
                <SubGroupLabel label="Approvals" />
                <SidebarItem href="/expense-approval" icon={<Receipt />} label="Expense Approval" />
                <SidebarItem href="/approvals/time" icon={<Clock />} label="Time Approval" />
                <SubGroupLabel label="Expenses" />
                <SidebarItem href="/expense-management" icon={<CreditCard />} label="Expense Management" />
                <SidebarItem href="/reimbursement-batches" icon={<Banknote />} label="Reimbursement Batches" />
                <SidebarItem href="/contractor-invoices" icon={<FileText />} label="Contractor Invoices" />
                <SubGroupLabel label="Rates" />
                <SidebarItem href="/rates" icon={<Calculator />} label="Rate Management" />
              </CollapsibleSection>
            )}
            
            {isAdmin && (
              <CollapsibleSection
                id="administration"
                title="Administration"
                isOpen={!!openSections["administration"]}
                onToggle={handleToggle}
              >
                <SubGroupLabel label="Users & Organization" />
                <SidebarItem href="/users" icon={<Users />} label="User Management" />
                <SidebarItem href="/organization-settings" icon={<Building2 />} label="Organization Settings" />
                {isPlatformAdmin && (
                  <SidebarItem href="/system-settings" icon={<Settings />} label="System Settings" />
                )}
                <SubGroupLabel label="System Tools" />
                <SidebarItem href="/admin/scheduled-jobs" icon={<CalendarClock />} label="Scheduled Jobs" />
                <SidebarItem href="/admin/agent-card-health" icon={<ActivitySquare />} label="Agent Card Health" />
                <SidebarItem href="/admin/background-jobs" icon={<Workflow />} label="Background Jobs" />
                <SidebarItem href="/file-repository" icon={<Database />} label="File Repository" />
                <SidebarItem href="/admin/sharepoint" icon={<Settings />} label="SharePoint Diagnostics" />
                <SidebarItem href="/m365-integration" icon={<Network />} label="M365 Integration Map" />
                <SidebarItem href="/admin/galaxy" icon={<Plug />} label="Galaxy API" requiredRoles={["admin"]} />
                {isPlatformAdmin && (
                  <SidebarItem href="/vocabulary" icon={<Languages />} label="Vocabulary Catalog" />
                )}
                <SubGroupLabel label="AI Configuration" />
                <SidebarItem href="/ai-grounding" icon={<Brain />} label="AI Grounding" />
                <SidebarItem href="/ai-settings" icon={<Brain />} label="AI Settings" requiredRoles={["admin"]} />
              </CollapsibleSection>
            )}
            
            {hasAnyRole(['admin', 'billing-admin']) && (
              <CollapsibleSection
                id="payroll"
                title="Payroll (Gemini)"
                isOpen={!!openSections["payroll"]}
                onToggle={handleToggle}
              >
                <SubGroupLabel label="Overview" />
                <SidebarItem href="/payroll" icon={<Wallet />} label="Payroll Dashboard" />
                <SubGroupLabel label="People" />
                <SidebarItem href="/payroll/employees" icon={<Users />} label="Employees" />
                <SidebarItem href="/payroll/schedules" icon={<CalendarClock />} label="Pay Schedules" />
                <SubGroupLabel label="Process" />
                <SidebarItem href="/payroll/runs" icon={<Banknote />} label="Payroll Runs" />
                <SubGroupLabel label="Accounting" />
                <SidebarItem href="/payroll/gl" icon={<Calculator />} label="General Ledger" />
                <SidebarItem href="/payroll/audit" icon={<ScrollText />} label="Audit Log" />
              </CollapsibleSection>
            )}

            {isPlatformAdmin && (
              <CollapsibleSection
                id="platform"
                title="Platform"
                isOpen={!!openSections["platform"]}
                onToggle={handleToggle}
              >
                <SubGroupLabel label="Tenant Management" />
                <SidebarItem href="/platform/tenants" icon={<Crown />} label="Tenants" />
                <SidebarItem href="/platform/service-plans" icon={<Package />} label="Service Plans" />
                <SidebarItem href="/platform/users" icon={<Shield />} label="Platform Users" />
                <SubGroupLabel label="Reference Data" />
                <SidebarItem href="/platform/airports" icon={<Plane />} label="Airport Codes" />
                <SidebarItem href="/platform/oconus" icon={<Globe />} label="OCONUS Rates" />
                <SidebarItem href="/platform/grounding-docs" icon={<Brain />} label="Platform AI Grounding" />
              </CollapsibleSection>
            )}
          </nav>
        </div>
      </ScrollArea>

      <div className="border-t border-border px-4 py-3 space-y-1">
        <SidebarItem href="/support" icon={<LifeBuoy />} label="Support" />
        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-2 w-full rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors cursor-pointer group">
            <BookOpen className="h-4 w-4 flex-shrink-0" />
            <span className="flex-1 text-left">Docs</span>
            <ChevronRight className="h-3.5 w-3.5 transition-transform duration-200 group-data-[state=open]:rotate-90" />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-1 pl-3">
            <SidebarItem href="/user-guide" icon={<BookOpen />} label="User Guide" />
            <SidebarItem href="/changelog" icon={<History />} label="Changelog" />
            <SidebarItem href="/roadmap" icon={<Map />} label="Roadmap" />
            <SidebarItem href="/about" icon={<Info />} label="About" />
          </CollapsibleContent>
        </Collapsible>
      </div>
    </aside>
  );
}
