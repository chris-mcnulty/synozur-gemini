import { useState, useEffect, useCallback } from 'react';
import { useAuth } from "@/hooks/use-auth";
import { Link, useLocation } from "wouter";
import { 
  Menu,
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
  CreditCard,
  Banknote,
  ChevronRight,
  BookOpen,
  CalendarClock,
  History,
  Map,
  GanttChart,
  Shield,
  Crown,
  Package,
  Plane,
  Globe,
  Database,
  ShieldAlert,
  Brain,
  LifeBuoy,
  Handshake,
  TrendingUp,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

const MOBILE_STORAGE_KEY = "constellation-mobile-nav-sections-v2";

function MobileSubGroupLabel({ label }: { label: string }) {
  return (
    <div className="px-4 pt-3 pb-1 first:pt-1">
      <span className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider">
        {label}
      </span>
    </div>
  );
}

interface MobileNavItemProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  badge?: string;
  requiredRoles?: string[];
  onClick?: () => void;
}

function MobileNavItem({ href, icon, label, badge, requiredRoles, onClick }: MobileNavItemProps) {
  const [location] = useLocation();
  const { hasAnyRole } = useAuth();
  
  const isActive = location === href;
  
  if (requiredRoles && !hasAnyRole(requiredRoles)) {
    return null;
  }

  return (
    <Link 
      href={href}
      onClick={onClick}
      className={cn(
        "flex items-center space-x-3 px-4 py-3 rounded-md transition-colors",
        isActive 
          ? 'bg-accent text-accent-foreground font-medium' 
          : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
      )}
      data-testid={`mobile-link-${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <div className="w-5 h-5 shrink-0">{icon}</div>
      <span className="flex-1">{label}</span>
      {badge && (
        <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full">
          {badge}
        </span>
      )}
    </Link>
  );
}

interface MobileCollapsibleSectionProps {
  id: string;
  title: string;
  children: React.ReactNode;
  isOpen: boolean;
  onToggle: (id: string) => void;
}

function MobileCollapsibleSection({ id, title, children, isOpen, onToggle }: MobileCollapsibleSectionProps) {
  return (
    <Collapsible open={isOpen} onOpenChange={() => onToggle(id)}>
      <CollapsibleTrigger className="flex items-center justify-between w-full px-4 pt-4 pb-2 group cursor-pointer">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider group-hover:text-foreground transition-colors">
          {title}
        </h3>
        <ChevronRight className={cn(
          "w-3.5 h-3.5 text-muted-foreground transition-transform duration-200",
          isOpen && "rotate-90"
        )} />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-0.5">
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
  { sectionId: "my-workspace", paths: ["/my-dashboard", "/my-assignments", "/my-projects", "/time", "/expenses", "/expense-reports", "/my-reimbursements", "/my-raidd"] },
  { sectionId: "portfolio", paths: ["/", "/dashboard", "/portfolio/timeline", "/portfolio/raidd", "/reports", "/executive-narrative", "/projects", "/clients", "/resource-management", "/resource-planning", "/resource-planning/capacity", "/crm/deals"] },
  { sectionId: "financial", paths: ["/billing", "/invoice-report", "/client-revenue-report", "/expense-management", "/expense-approval", "/reimbursement-batches", "/rates"] },
  { sectionId: "administration", paths: ["/users", "/organization-settings", "/system-settings", "/admin/scheduled-jobs", "/file-repository", "/admin/sharepoint", "/vocabulary", "/ai-grounding", "/ai-settings"] },
  { sectionId: "platform", paths: ["/platform/tenants", "/platform/service-plans", "/platform/users", "/platform/airports", "/platform/oconus", "/platform/grounding-docs"] },
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

function loadMobileSectionState(): Record<string, boolean> {
  try {
    const stored = localStorage.getItem(MOBILE_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return { "my-workspace": true };
}

function saveMobileSectionState(state: Record<string, boolean>) {
  try {
    localStorage.setItem(MOBILE_STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const { hasAnyRole, isPlatformAdmin, user } = useAuth();
  const [location] = useLocation();
  
  const isManager = hasAnyRole(['admin', 'pm', 'portfolio-manager', 'executive']);
  const isFinanceRole = hasAnyRole(['admin', 'billing-admin']);
  const isAdmin = hasAnyRole(['admin']);

  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    const saved = loadMobileSectionState();
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
        saveMobileSectionState(next);
        return next;
      });
    }
  }, [location]);

  const handleToggle = useCallback((id: string) => {
    setOpenSections(prev => {
      const next = { ...prev, [id]: !prev[id] };
      saveMobileSectionState(next);
      return next;
    });
  }, []);
  
  const handleNavClick = () => {
    setOpen(false);
  };
  
  return (
    <div className="lg:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button 
            variant="ghost" 
            size="icon" 
            className="lg:hidden"
            data-testid="mobile-menu-toggle"
          >
            <Menu className="h-6 w-6" />
            <span className="sr-only">Toggle menu</span>
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-[85vw] sm:w-[385px] p-0 flex flex-col">
          <SheetHeader className="px-6 py-4 border-b">
            <SheetTitle className="text-left">Constellation</SheetTitle>
            <div className="text-sm text-muted-foreground">
              {user ? (
                user.firstName && user.lastName 
                  ? `${user.firstName} ${user.lastName}` 
                  : user.name || user.email
              ) : ''}
            </div>
          </SheetHeader>
          
          <ScrollArea className="flex-1">
            <div className="pb-4">
              <MobileCollapsibleSection
                id="my-workspace"
                title="My Workspace"
                isOpen={!!openSections["my-workspace"]}
                onToggle={handleToggle}
              >
                <MobileSubGroupLabel label="Daily Work" />
                <MobileNavItem href="/my-dashboard" icon={<Home />} label="My Dashboard" onClick={handleNavClick} />
                <MobileNavItem href="/my-assignments" icon={<Briefcase />} label="Assignments" onClick={handleNavClick} />
                <MobileNavItem href="/my-projects" icon={<FolderOpen />} label="My Projects" onClick={handleNavClick} />
                <MobileSubGroupLabel label="Time & Expenses" />
                <MobileNavItem href="/time" icon={<Clock />} label="Timesheets" onClick={handleNavClick} />
                <MobileNavItem href="/expenses" icon={<Receipt />} label="Expenses" onClick={handleNavClick} />
                <MobileNavItem href="/expense-reports" icon={<FileText />} label="Expense Reports" onClick={handleNavClick} />
                <MobileSubGroupLabel label="Tracking" />
                <MobileNavItem href="/my-reimbursements" icon={<Banknote />} label="My Reimbursements" onClick={handleNavClick} />
                <MobileNavItem href="/my-raidd" icon={<Shield />} label="My RAIDD" onClick={handleNavClick} />
              </MobileCollapsibleSection>
              
              {isManager && (
                <>
                  <Separator className="my-2" />
                  <MobileCollapsibleSection
                    id="portfolio"
                    title="Portfolio"
                    isOpen={!!openSections["portfolio"]}
                    onToggle={handleToggle}
                  >
                    <MobileSubGroupLabel label="Overview" />
                    <MobileNavItem href="/" icon={<ChartLine />} label="Portfolio Dashboard" onClick={handleNavClick} />
                    <MobileNavItem href="/portfolio/timeline" icon={<GanttChart />} label="Portfolio Timeline" onClick={handleNavClick} />
                    {hasAnyRole(["admin", "pm", "portfolio-manager", "executive"]) && (
                      <MobileNavItem href="/portfolio/raidd" icon={<ShieldAlert />} label="Portfolio RAIDD" onClick={handleNavClick} />
                    )}
                    <MobileNavItem href="/reports" icon={<BarChart3 />} label="Reports" onClick={handleNavClick} />
                    {hasAnyRole(["admin", "pm", "portfolio-manager", "executive"]) && (
                      <MobileNavItem href="/executive-narrative" icon={<Brain />} label="Executive Narrative" onClick={handleNavClick} />
                    )}
                    <MobileSubGroupLabel label="Management" />
                    <MobileNavItem href="/projects" icon={<FolderOpen />} label="All Projects" onClick={handleNavClick} />
                    <MobileNavItem href="/clients" icon={<Building2 />} label="Clients" onClick={handleNavClick} />
                    <MobileNavItem href="/resource-management" icon={<Users />} label="Resources" onClick={handleNavClick} />
                    <MobileNavItem href="/resource-planning" icon={<GanttChart />} label="Resource Planning" requiredRoles={["admin", "pm", "portfolio-manager", "executive"]} onClick={handleNavClick} />
                    <MobileNavItem href="/resource-planning/capacity" icon={<TrendingUp />} label="Capacity Planning" requiredRoles={["admin", "pm", "portfolio-manager", "executive"]} onClick={handleNavClick} />
                    <MobileSubGroupLabel label="Pipeline" />
                    <MobileNavItem href="/crm/deals" icon={<Handshake />} label="CRM Deals" requiredRoles={["admin", "pm", "portfolio-manager"]} onClick={handleNavClick} />
                  </MobileCollapsibleSection>
                </>
              )}
              
              {isFinanceRole && (
                <>
                  <Separator className="my-2" />
                  <MobileCollapsibleSection
                    id="financial"
                    title="Financial"
                    isOpen={!!openSections["financial"]}
                    onToggle={handleToggle}
                  >
                    <MobileSubGroupLabel label="Billing" />
                    <MobileNavItem href="/billing" icon={<DollarSign />} label="Billing & Invoicing" onClick={handleNavClick} />
                    <MobileNavItem href="/invoice-report" icon={<FileText />} label="Invoice Report" onClick={handleNavClick} />
                    <MobileNavItem href="/client-revenue-report" icon={<Building2 />} label="Client Revenue" onClick={handleNavClick} />
                    <MobileSubGroupLabel label="Expenses" />
                    <MobileNavItem href="/expense-management" icon={<CreditCard />} label="Expense Management" onClick={handleNavClick} />
                    <MobileNavItem href="/expense-approval" icon={<Receipt />} label="Expense Approval" onClick={handleNavClick} />
                    <MobileNavItem href="/reimbursement-batches" icon={<Banknote />} label="Reimbursement Batches" onClick={handleNavClick} />
                    <MobileSubGroupLabel label="Rates" />
                    <MobileNavItem href="/rates" icon={<Calculator />} label="Rate Management" onClick={handleNavClick} />
                  </MobileCollapsibleSection>
                </>
              )}
              
              {isAdmin && (
                <>
                  <Separator className="my-2" />
                  <MobileCollapsibleSection
                    id="administration"
                    title="Administration"
                    isOpen={!!openSections["administration"]}
                    onToggle={handleToggle}
                  >
                    <MobileSubGroupLabel label="Users & Organization" />
                    <MobileNavItem href="/users" icon={<Users />} label="User Management" onClick={handleNavClick} />
                    <MobileNavItem href="/organization-settings" icon={<Building2 />} label="Organization Settings" onClick={handleNavClick} />
                    {isPlatformAdmin && (
                      <MobileNavItem href="/system-settings" icon={<Settings />} label="System Settings" onClick={handleNavClick} />
                    )}
                    <MobileSubGroupLabel label="System Tools" />
                    <MobileNavItem href="/admin/scheduled-jobs" icon={<CalendarClock />} label="Scheduled Jobs" onClick={handleNavClick} />
                    <MobileNavItem href="/file-repository" icon={<Database />} label="File Repository" onClick={handleNavClick} />
                    <MobileNavItem href="/admin/sharepoint" icon={<Settings />} label="SharePoint Diagnostics" onClick={handleNavClick} />
                    {isPlatformAdmin && (
                      <MobileNavItem href="/vocabulary" icon={<Languages />} label="Vocabulary Catalog" onClick={handleNavClick} />
                    )}
                    <MobileSubGroupLabel label="AI Configuration" />
                    <MobileNavItem href="/ai-grounding" icon={<Brain />} label="AI Grounding" onClick={handleNavClick} />
                    <MobileNavItem href="/ai-settings" icon={<Brain />} label="AI Settings" requiredRoles={["admin"]} onClick={handleNavClick} />
                  </MobileCollapsibleSection>
                </>
              )}
              
              {isPlatformAdmin && (
                <>
                  <Separator className="my-2" />
                  <MobileCollapsibleSection
                    id="platform"
                    title="Platform"
                    isOpen={!!openSections["platform"]}
                    onToggle={handleToggle}
                  >
                    <MobileSubGroupLabel label="Tenant Management" />
                    <MobileNavItem href="/platform/tenants" icon={<Crown />} label="Tenants" onClick={handleNavClick} />
                    <MobileNavItem href="/platform/service-plans" icon={<Package />} label="Service Plans" onClick={handleNavClick} />
                    <MobileNavItem href="/platform/users" icon={<Shield />} label="Platform Users" onClick={handleNavClick} />
                    <MobileSubGroupLabel label="Reference Data" />
                    <MobileNavItem href="/platform/airports" icon={<Plane />} label="Airport Codes" onClick={handleNavClick} />
                    <MobileNavItem href="/platform/oconus" icon={<Globe />} label="OCONUS Rates" onClick={handleNavClick} />
                    <MobileNavItem href="/platform/grounding-docs" icon={<Brain />} label="Platform AI Grounding" onClick={handleNavClick} />
                  </MobileCollapsibleSection>
                </>
              )}
            </div>
          </ScrollArea>

          <div className="border-t border-border px-2 py-3 space-y-0.5">
            <MobileNavItem href="/support" icon={<LifeBuoy />} label="Support" onClick={handleNavClick} />
            <Collapsible>
              <CollapsibleTrigger className="flex items-center gap-2 w-full rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors cursor-pointer group">
                <BookOpen className="h-4 w-4 flex-shrink-0" />
                <span className="flex-1 text-left">Docs</span>
                <ChevronRight className="h-3.5 w-3.5 transition-transform duration-200 group-data-[state=open]:rotate-90" />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-0.5 pl-3">
                <MobileNavItem href="/user-guide" icon={<BookOpen />} label="User Guide" onClick={handleNavClick} />
                <MobileNavItem href="/changelog" icon={<History />} label="Changelog" onClick={handleNavClick} />
                <MobileNavItem href="/roadmap" icon={<Map />} label="Roadmap" onClick={handleNavClick} />
                <MobileNavItem href="/about" icon={<Info />} label="About" onClick={handleNavClick} />
              </CollapsibleContent>
            </Collapsible>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
