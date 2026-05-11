import { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  ShieldAlert,
  Brain,
  LifeBuoy,
  ActivitySquare,
} from "lucide-react";

interface NavItemProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  onClose: () => void;
}

function NavItem({ href, icon, label, onClose }: NavItemProps) {
  return (
    <Link
      href={href}
      onClick={onClose}
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
        "text-muted-foreground hover:text-foreground hover:bg-accent/50"
      )}
    >
      <span className="w-4 h-4 shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </Link>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="px-3 pt-4 pb-1">
      <span className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider">
        {label}
      </span>
    </div>
  );
}

function Divider() {
  return <div className="my-2 mx-3 border-t border-border" />;
}

export function EmbedNavDrawer() {
  const [open, setOpen] = useState(false);
  const { hasAnyRole, isPlatformAdmin } = useAuth();

  const isManager = hasAnyRole(["admin", "pm", "portfolio-manager", "executive"]);
  const isFinanceRole = hasAnyRole(["admin", "billing-admin"]);
  const isAdmin = hasAnyRole(["admin"]);

  const close = () => setOpen(false);

  return (
    <>
      <Button
        variant="outline"
        size="icon"
        className="fixed top-3 left-3 z-40 h-8 w-8 bg-card shadow-sm"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
      >
        <Menu className="h-4 w-4" />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-64 p-0 flex flex-col">
          <SheetHeader className="px-4 py-3 border-b border-border shrink-0">
            <SheetTitle className="text-sm font-semibold tracking-tight">
              Constellation
            </SheetTitle>
          </SheetHeader>

          <ScrollArea className="flex-1">
            <div className="px-1 py-2 space-y-0.5">

              <SectionLabel label="My Workspace" />
              <NavItem href="/my-dashboard"    icon={<Home />}      label="My Dashboard"  onClose={close} />
              <NavItem href="/my-assignments"  icon={<Briefcase />} label="Assignments"   onClose={close} />
              <NavItem href="/my-projects"     icon={<FolderOpen />}label="My Projects"   onClose={close} />
              <NavItem href="/time"            icon={<Clock />}     label="Timesheets"    onClose={close} />
              <NavItem href="/expenses"        icon={<Receipt />}   label="Expenses"      onClose={close} />
              <NavItem href="/expense-reports" icon={<FileText />}  label="Expense Reports" onClose={close} />
              <NavItem href="/my-reimbursements" icon={<Banknote />} label="My Reimbursements" onClose={close} />
              <NavItem href="/my-raidd"        icon={<Shield />}    label="My RAIDD"      onClose={close} />

              {isManager && (
                <>
                  <Divider />
                  <SectionLabel label="Portfolio" />
                  <NavItem href="/"                        icon={<ChartLine />}     label="Portfolio Dashboard"  onClose={close} />
                  <NavItem href="/portfolio/timeline"      icon={<GanttChart />}    label="Portfolio Timeline"   onClose={close} />
                  <NavItem href="/portfolio/raidd"         icon={<ShieldAlert />}   label="Portfolio RAIDD"      onClose={close} />
                  <NavItem href="/portfolio/schedule-health" icon={<ActivitySquare />} label="Schedule Health"  onClose={close} />
                  <NavItem href="/reports"                 icon={<BarChart3 />}     label="Reports"              onClose={close} />
                  <NavItem href="/projects"                icon={<FolderOpen />}    label="All Projects"         onClose={close} />
                  <NavItem href="/clients"                 icon={<Building2 />}     label="Clients"              onClose={close} />
                  <NavItem href="/resource-management"     icon={<Users />}         label="Resources"            onClose={close} />
                  {hasAnyRole(["admin", "pm", "portfolio-manager"]) && (
                    <NavItem href="/crm/deals"             icon={<Handshake />}     label="CRM Deals"            onClose={close} />
                  )}
                </>
              )}

              {isFinanceRole && (
                <>
                  <Divider />
                  <SectionLabel label="Financial" />
                  <NavItem href="/billing"                icon={<DollarSign />}  label="Billing & Invoicing"    onClose={close} />
                  <NavItem href="/invoice-report"         icon={<FileText />}    label="Invoice Report"         onClose={close} />
                  <NavItem href="/client-revenue-report"  icon={<Building2 />}   label="Client Revenue"         onClose={close} />
                  <NavItem href="/expense-management"     icon={<CreditCard />}  label="Expense Management"     onClose={close} />
                  <NavItem href="/expense-approval"       icon={<Receipt />}     label="Expense Approval"       onClose={close} />
                  <NavItem href="/reimbursement-batches"  icon={<Banknote />}    label="Reimbursement Batches"  onClose={close} />
                  <NavItem href="/rates"                  icon={<Calculator />}  label="Rate Management"        onClose={close} />
                </>
              )}

              {isAdmin && (
                <>
                  <Divider />
                  <SectionLabel label="Administration" />
                  <NavItem href="/users"                 icon={<Users />}       label="User Management"        onClose={close} />
                  <NavItem href="/organization-settings" icon={<Building2 />}   label="Organization Settings"  onClose={close} />
                  <NavItem href="/admin/scheduled-jobs"  icon={<CalendarClock />} label="Scheduled Jobs"       onClose={close} />
                  <NavItem href="/file-repository"       icon={<Database />}    label="File Repository"        onClose={close} />
                  <NavItem href="/ai-grounding"          icon={<Brain />}       label="AI Grounding"           onClose={close} />
                  <NavItem href="/ai-settings"           icon={<Brain />}       label="AI Settings"            onClose={close} />
                </>
              )}

              {isPlatformAdmin && (
                <>
                  <Divider />
                  <SectionLabel label="Platform" />
                  <NavItem href="/platform/tenants"       icon={<Crown />}  label="Tenants"               onClose={close} />
                  <NavItem href="/platform/service-plans" icon={<Package />}label="Service Plans"         onClose={close} />
                  <NavItem href="/platform/users"         icon={<Shield />} label="Platform Users"        onClose={close} />
                  <NavItem href="/platform/airports"      icon={<Plane />}  label="Airport Codes"         onClose={close} />
                  <NavItem href="/platform/oconus"        icon={<Globe />}  label="OCONUS Rates"          onClose={close} />
                  <NavItem href="/platform/grounding-docs" icon={<Brain />} label="Platform AI Grounding" onClose={close} />
                </>
              )}

              <Divider />
              <NavItem href="/support"   icon={<LifeBuoy />}  label="Support"   onClose={close} />
              <NavItem href="/user-guide" icon={<BookOpen />} label="User Guide" onClose={close} />
              <NavItem href="/changelog"  icon={<History />}  label="Changelog"  onClose={close} />
              <NavItem href="/roadmap"    icon={<Map />}      label="Roadmap"    onClose={close} />
              <NavItem href="/about"      icon={<Info />}     label="About"      onClose={close} />

            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </>
  );
}
