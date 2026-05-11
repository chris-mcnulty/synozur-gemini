import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import Dashboard from "@/pages/dashboard";
import Projects from "@/pages/projects";
import ProjectDetail from "@/pages/project-detail";
import Clients from "@/pages/clients";
import ClientDetail from "@/pages/client-detail";
import TimeTracking from "@/pages/time-tracking";
import Expenses from "@/pages/expenses";
import ExpenseManagement from "@/pages/expense-management";
import ExpenseReports from "@/pages/expense-reports";
import ExpenseApproval from "@/pages/expense-approval";
import TimeApproval from "@/pages/time-approval";
import ReimbursementBatches from "@/pages/reimbursement-batches";
import ContractorInvoices from "@/pages/contractor-invoices";
import MyContractorInvoices from "@/pages/my-contractor-invoices";
import Billing from "@/pages/billing";
import BatchDetail from "@/pages/batch-detail";
import RateManagement from "@/pages/rate-management";
import Users from "@/pages/users";
import Reports from "@/pages/reports";
import InvoiceReport from "@/pages/invoice-report";
import ClientRevenueReport from "@/pages/client-revenue-report";
import { MyAssignments } from "@/pages/my-assignments";
import MyProjectsDashboard from "@/pages/my-projects-dashboard";
import ResourceManagement from "@/pages/resource-management";
import CrossProjectResource from "@/pages/cross-project-resource";
import SystemSettings from "@/pages/system-settings";
import OrganizationSettings from "@/pages/organization-settings";
import ScheduledJobs from "@/pages/scheduled-jobs";
import GalaxyAdminPage from "@/pages/admin/galaxy";
import BackgroundJobs from "@/pages/background-jobs";
import AgentCardHealth from "@/pages/agent-card-health";
import AdminPlannerSyncHealthPage from "@/pages/admin/planner-sync-health";
import AdminSignoffsPage from "@/pages/admin/signoffs";
import { AdminSharePoint } from "@/pages/admin-sharepoint";
import PlatformTenants from "@/pages/platform-tenants";
import PlatformServicePlans from "@/pages/platform-service-plans";
import PlatformUsers from "@/pages/platform-users";
import PlatformAirports from "@/pages/platform-airports";
import PlatformOconus from "@/pages/platform-oconus";
import PlatformGroundingDocs from "@/pages/platform-grounding-docs";
import TenantGroundingDocs from "@/pages/tenant-grounding-docs";
import About from "@/pages/about";
import UserGuide from "@/pages/user-guide";
import Changelog from "@/pages/changelog";
import Roadmap from "@/pages/roadmap";
import Support from "@/pages/support";
import Login from "@/pages/login";
import Signup from "@/pages/signup";
import FileRepository from "@/pages/file-repository";
import PortfolioTimelinePage from "@/pages/portfolio-timeline-page";
import PortfolioRaidd from "@/pages/portfolio-raidd";
import PortfolioSlippage from "@/pages/portfolio-slippage";
import MyRaidd from "@/pages/my-raidd";
import CrmDeals from "@/pages/crm-deals";
import AiSettings from "@/pages/ai-settings";
import ExecutiveNarrative from "@/pages/executive-narrative";
import M365IntegrationDiagram from "@/pages/m365-integration-diagram";
import EmbedProject from "@/pages/embed-project";
import EmbedConfigure from "@/pages/embed-configure";
import EmbedDashboard from "@/pages/embed-dashboard";
import EmbedAuthPopup from "@/pages/embed-auth-popup";
import ResourcePlanning from "@/pages/resource-planning";
import CapacityPlanning from "@/pages/capacity-planning";
import NotFound from "@/pages/not-found";
import NotificationsPage from "@/pages/notifications";
import NotificationPreferencesPage from "@/pages/notification-preferences";
import PayrollDashboard from "@/pages/payroll-dashboard";
import PayrollEmployees from "@/pages/payroll-employees";
import PayrollEmployeeDetail from "@/pages/payroll-employee-detail";
import PayrollSchedules from "@/pages/payroll-schedules";
import PayrollRuns from "@/pages/payroll-runs";
import PayrollRunDetail from "@/pages/payroll-run-detail";
import PayrollGl from "@/pages/payroll-gl";
import PayrollAudit from "@/pages/payroll-audit";
import { useQuery } from "@tanstack/react-query";
import { Redirect, useLocation } from "wouter";
import { useEffect, useState } from "react";
import { setSessionId } from "@/lib/queryClient";
import { useSessionRecovery } from "@/hooks/use-session-recovery";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";

// Permission wrapper component for tenant roles
function PermissionGuard({ children, allowedRoles, allowPlatformAdmin = false }: { children: React.ReactNode; allowedRoles: string[]; allowPlatformAdmin?: boolean }) {
  const { hasAnyRole, isPlatformAdmin } = useAuth();

  if (!hasAnyRole(allowedRoles) && !(allowPlatformAdmin && isPlatformAdmin)) {
    return <Redirect to="/dashboard" />;
  }

  return <>{children}</>;
}

// Permission wrapper for platform admin routes
function PlatformAdminGuard({ children }: { children: React.ReactNode }) {
  const { isPlatformAdmin } = useAuth();
  
  if (!isPlatformAdmin) {
    return <Redirect to="/dashboard" />;
  }
  
  return <>{children}</>;
}

function Router() {
  const [processingSession, setProcessingSession] = useState(true);
  const { isRecovering } = useSessionRecovery();
  const [, setLocation] = useLocation();
  
  // Get user data first
  const { data: user, isLoading, error } = useQuery({
    queryKey: ["/api/auth/user"],
    retry: false,
    enabled: !processingSession && !isRecovering, // Only check auth after processing sessionId and not recovering
  });
  
  // Update page title based on environment
  useEffect(() => {
    const isDevelopment = import.meta.env.MODE === 'development';
    const baseTitle = 'Constellation | Synozur Consulting Delivery Platform';
    document.title = isDevelopment ? `Development - ${baseTitle}` : baseTitle;
  }, []);
  
  // Handle sessionId from SSO callback FIRST
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('sessionId');
    
    if (sessionId) {
      // Store session and reload to clean URL
      setSessionId(sessionId);
      localStorage.setItem('sessionId', sessionId);
      // Clean URL and reload
      window.location.href = "/";
    } else {
      setProcessingSession(false);
    }
  }, []);
  
  // Check for redirect after login
  useEffect(() => {
    const redirectPath = sessionStorage.getItem('redirectAfterLogin');
    if (redirectPath && user) {
      sessionStorage.removeItem('redirectAfterLogin');
      setLocation(redirectPath);
    }
  }, [user, setLocation]);

  // Handle session errors - redirect to login (with loop protection)
  useEffect(() => {
    if (error && !user && !isLoading && !processingSession && !isRecovering) {
      const currentPath = window.location.pathname;
      if (currentPath !== '/login' && currentPath !== '/signup' && !currentPath.startsWith('/embed/')) {
        const lastRedirect = sessionStorage.getItem('redirectAfterLogin');
        const redirectCount = parseInt(sessionStorage.getItem('redirectLoopCount') || '0', 10);
        if (lastRedirect === currentPath && redirectCount >= 2) {
          sessionStorage.removeItem('redirectAfterLogin');
          sessionStorage.removeItem('redirectLoopCount');
        } else {
          if (currentPath !== '/' && currentPath !== '/login') {
            sessionStorage.setItem('redirectAfterLogin', currentPath);
            sessionStorage.setItem('redirectLoopCount', String(lastRedirect === currentPath ? redirectCount + 1 : 1));
          }
        }
        setLocation('/login');
      }
    }
  }, [error, user, isLoading, processingSession, isRecovering, setLocation]);

  const isEmbedRoute = window.location.pathname.startsWith('/embed/');

  if ((processingSession || isLoading || isRecovering) && !isEmbedRoute) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <div className="text-lg text-muted-foreground">
            {isRecovering ? "Recovering session..." : "Loading..."}
          </div>
        </div>
      </div>
    );
  }

  return (
    <Switch>
      <Route path="/embed/auth-popup" component={EmbedAuthPopup} />
      <Route path="/embed/configure" component={EmbedConfigure} />
      <Route path="/embed/dashboard" component={EmbedDashboard} />
      <Route path="/embed/projects/:id" component={EmbedProject} />
      <Route path="/login" component={Login} />
      <Route path="/signup" component={Signup} />
      <Route path="/">
        {user ? <Dashboard /> : <Redirect to="/login" />}
      </Route>
      <Route path="/dashboard">
        {user ? <Dashboard /> : <Redirect to="/login" />}
      </Route>
      {/* Personal workspace routes */}
      <Route path="/my-dashboard">
        {user ? <Dashboard /> : <Redirect to="/login" />}
      </Route>
      <Route path="/my-projects">
        {user ? <MyProjectsDashboard /> : <Redirect to="/login" />}
      </Route>
      <Route path="/my-raidd">
        {user ? <MyRaidd /> : <Redirect to="/login" />}
      </Route>
      <Route path="/portfolio/timeline">
        {user ? <PortfolioTimelinePage /> : <Redirect to="/login" />}
      </Route>
      <Route path="/portfolio/raidd">
        {user ? (
          <PermissionGuard allowedRoles={["admin", "pm", "executive"]}>
            <PortfolioRaidd />
          </PermissionGuard>
        ) : <Redirect to="/login" />}
      </Route>
      <Route path="/portfolio/schedule-health">
        {user ? (
          <PermissionGuard allowedRoles={["admin", "billing-admin", "pm", "portfolio-manager", "executive"]}>
            <PortfolioSlippage />
          </PermissionGuard>
        ) : <Redirect to="/login" />}
      </Route>
      <Route path="/projects">
        {user ? <Projects /> : <Redirect to="/login" />}
      </Route>
      <Route path="/projects/:id">
        {user ? <ProjectDetail /> : <Redirect to="/login" />}
      </Route>
      <Route path="/clients">
        {user ? <Clients /> : <Redirect to="/login" />}
      </Route>
      <Route path="/clients/:id">
        {user ? <ClientDetail /> : <Redirect to="/login" />}
      </Route>
      <Route path="/time">
        {user ? <TimeTracking /> : <Redirect to="/login" />}
      </Route>
      <Route path="/expenses">
        {user ? <Expenses /> : <Redirect to="/login" />}
      </Route>
      <Route path="/expense-management">
        {user ? <ExpenseManagement /> : <Redirect to="/login" />}
      </Route>
      <Route path="/expense-reports">
        {user ? <ExpenseReports /> : <Redirect to="/login" />}
      </Route>
      <Route path="/expense-approval">
        {user ? (
          <PermissionGuard allowedRoles={['admin', 'executive', 'billing-admin']}>
            <ExpenseApproval />
          </PermissionGuard>
        ) : <Redirect to="/login" />}
      </Route>
      <Route path="/approvals/time">
        {user ? (
          <PermissionGuard allowedRoles={['admin', 'billing-admin', 'pm', 'executive', 'portfolio-manager']}>
            <TimeApproval />
          </PermissionGuard>
        ) : <Redirect to="/login" />}
      </Route>
      <Route path="/reimbursement-batches">
        {user ? (
          <PermissionGuard allowedRoles={['admin', 'billing-admin']}>
            <ReimbursementBatches />
          </PermissionGuard>
        ) : <Redirect to="/login" />}
      </Route>
      <Route path="/my-reimbursements">
        {user ? <ReimbursementBatches /> : <Redirect to="/login" />}
      </Route>
      <Route path="/contractor-invoices">
        {user ? (
          <PermissionGuard allowedRoles={['admin', 'billing-admin']}>
            <ContractorInvoices />
          </PermissionGuard>
        ) : <Redirect to="/login" />}
      </Route>
      <Route path="/my-contractor-invoices">
        {user ? <MyContractorInvoices /> : <Redirect to="/login" />}
      </Route>
      <Route path="/billing">
        {user ? <Billing /> : <Redirect to="/login" />}
      </Route>
      <Route path="/billing/batches/:batchId">
        {user ? <BatchDetail /> : <Redirect to="/login" />}
      </Route>
      <Route path="/rates">
        {user ? <RateManagement /> : <Redirect to="/login" />}
      </Route>
      <Route path="/invoice-report">
        {user ? <InvoiceReport /> : <Redirect to="/login" />}
      </Route>
      <Route path="/client-revenue-report">
        {user ? <ClientRevenueReport /> : <Redirect to="/login" />}
      </Route>
      <Route path="/users">
        {user ? <Users /> : <Redirect to="/login" />}
      </Route>
      <Route path="/my-assignments">
        {user ? <MyAssignments /> : <Redirect to="/login" />}
      </Route>
      <Route path="/resource-management">
        {user ? <ResourceManagement /> : <Redirect to="/login" />}
      </Route>
      <Route path="/cross-project-resource">
        {user ? <CrossProjectResource /> : <Redirect to="/login" />}
      </Route>
      <Route path="/resource-planning">
        {user ? (
          <PermissionGuard allowedRoles={["admin", "pm", "portfolio-manager", "executive"]}>
            <ResourcePlanning />
          </PermissionGuard>
        ) : <Redirect to="/login" />}
      </Route>
      <Route path="/resource-planning/capacity">
        {user ? (
          <PermissionGuard allowedRoles={["admin", "pm", "portfolio-manager", "executive"]}>
            <CapacityPlanning />
          </PermissionGuard>
        ) : <Redirect to="/login" />}
      </Route>
      <Route path="/system-settings">
        {user ? <SystemSettings /> : <Redirect to="/login" />}
      </Route>
      <Route path="/organization-settings">
        {user ? <OrganizationSettings /> : <Redirect to="/login" />}
      </Route>
      <Route path="/admin/sharepoint">
        {user ? <AdminSharePoint /> : <Redirect to="/login" />}
      </Route>
      <Route path="/m365-integration">
        {user ? (
          <PermissionGuard allowedRoles={["admin"]}>
            <M365IntegrationDiagram />
          </PermissionGuard>
        ) : <Redirect to="/login" />}
      </Route>
      <Route path="/admin/scheduled-jobs">
        {user ? (
          <PermissionGuard allowedRoles={["admin"]}>
            <ScheduledJobs />
          </PermissionGuard>
        ) : <Redirect to="/login" />}
      </Route>
      <Route path="/admin/galaxy">
        {user ? (
          <PermissionGuard allowedRoles={["admin"]}>
            <GalaxyAdminPage />
          </PermissionGuard>
        ) : <Redirect to="/login" />}
      </Route>
      <Route path="/admin/background-jobs">
        {user ? (
          <PermissionGuard allowedRoles={["admin"]} allowPlatformAdmin>
            <BackgroundJobs />
          </PermissionGuard>
        ) : <Redirect to="/login" />}
      </Route>
      <Route path="/admin/agent-card-health">
        {user ? (
          <PermissionGuard allowedRoles={["admin"]}>
            <AgentCardHealth />
          </PermissionGuard>
        ) : <Redirect to="/login" />}
      </Route>
      <Route path="/admin/signoffs">
        {user ? (
          <PermissionGuard allowedRoles={["admin", "pm"]}>
            <AdminSignoffsPage />
          </PermissionGuard>
        ) : <Redirect to="/login" />}
      </Route>
      <Route path="/admin/planner-sync-health">
        {user ? (
          <PermissionGuard allowedRoles={["admin"]}>
            <AdminPlannerSyncHealthPage />
          </PermissionGuard>
        ) : <Redirect to="/login" />}
      </Route>
      <Route path="/platform/tenants">
        {user ? (
          <PlatformAdminGuard>
            <PlatformTenants />
          </PlatformAdminGuard>
        ) : <Redirect to="/login" />}
      </Route>
      <Route path="/platform/service-plans">
        {user ? (
          <PlatformAdminGuard>
            <PlatformServicePlans />
          </PlatformAdminGuard>
        ) : <Redirect to="/login" />}
      </Route>
      <Route path="/platform/users">
        {user ? (
          <PlatformAdminGuard>
            <PlatformUsers />
          </PlatformAdminGuard>
        ) : <Redirect to="/login" />}
      </Route>
      <Route path="/platform/airports">
        {user ? (
          <PlatformAdminGuard>
            <PlatformAirports />
          </PlatformAdminGuard>
        ) : <Redirect to="/login" />}
      </Route>
      <Route path="/platform/oconus">
        {user ? (
          <PlatformAdminGuard>
            <PlatformOconus />
          </PlatformAdminGuard>
        ) : <Redirect to="/login" />}
      </Route>
      <Route path="/platform/grounding-docs">
        {user ? (
          <PlatformAdminGuard>
            <PlatformGroundingDocs />
          </PlatformAdminGuard>
        ) : <Redirect to="/login" />}
      </Route>
      <Route path="/vocabulary">
        {user ? (
          <PlatformAdminGuard>
            <SystemSettings />
          </PlatformAdminGuard>
        ) : <Redirect to="/login" />}
      </Route>
      <Route path="/crm/deals">
        {user ? <CrmDeals /> : <Redirect to="/login" />}
      </Route>
      <Route path="/file-repository">
        {user ? <FileRepository /> : <Redirect to="/login" />}
      </Route>
      <Route path="/ai-grounding">
        {user ? (
          <PermissionGuard allowedRoles={["admin", "pm"]}>
            <TenantGroundingDocs />
          </PermissionGuard>
        ) : <Redirect to="/login" />}
      </Route>
      <Route path="/ai-settings">
        {user ? (
          <PermissionGuard allowedRoles={["admin"]}>
            <AiSettings />
          </PermissionGuard>
        ) : <Redirect to="/login" />}
      </Route>
      <Route path="/reports">
        {user ? <Reports /> : <Redirect to="/login" />}
      </Route>
      <Route path="/executive-narrative">
        {user ? <ExecutiveNarrative /> : <Redirect to="/login" />}
      </Route>
      <Route path="/about">
        {user ? <About /> : <Redirect to="/login" />}
      </Route>
      <Route path="/user-guide">
        {user ? <UserGuide /> : <Redirect to="/login" />}
      </Route>
      <Route path="/changelog">
        {user ? <Changelog /> : <Redirect to="/login" />}
      </Route>
      <Route path="/roadmap">
        {user ? <Roadmap /> : <Redirect to="/login" />}
      </Route>
      <Route path="/support">
        {user ? <Support /> : <Redirect to="/login" />}
      </Route>
      <Route path="/notifications">
        {user ? <NotificationsPage /> : <Redirect to="/login" />}
      </Route>
      <Route path="/notifications/preferences">
        {user ? <NotificationPreferencesPage /> : <Redirect to="/login" />}
      </Route>
      {/* Gemini Payroll */}
      <Route path="/payroll">
        {user ? <PermissionGuard allowedRoles={["admin", "billing-admin"]}><PayrollDashboard /></PermissionGuard> : <Redirect to="/login" />}
      </Route>
      <Route path="/payroll/employees">
        {user ? <PermissionGuard allowedRoles={["admin", "billing-admin"]}><PayrollEmployees /></PermissionGuard> : <Redirect to="/login" />}
      </Route>
      <Route path="/payroll/employees/:id">
        {user ? <PermissionGuard allowedRoles={["admin", "billing-admin"]}><PayrollEmployeeDetail /></PermissionGuard> : <Redirect to="/login" />}
      </Route>
      <Route path="/payroll/schedules">
        {user ? <PermissionGuard allowedRoles={["admin", "billing-admin"]}><PayrollSchedules /></PermissionGuard> : <Redirect to="/login" />}
      </Route>
      <Route path="/payroll/runs">
        {user ? <PermissionGuard allowedRoles={["admin", "billing-admin"]}><PayrollRuns /></PermissionGuard> : <Redirect to="/login" />}
      </Route>
      <Route path="/payroll/runs/:id">
        {user ? <PermissionGuard allowedRoles={["admin", "billing-admin"]}><PayrollRunDetail /></PermissionGuard> : <Redirect to="/login" />}
      </Route>
      <Route path="/payroll/gl">
        {user ? <PermissionGuard allowedRoles={["admin", "billing-admin"]}><PayrollGl /></PermissionGuard> : <Redirect to="/login" />}
      </Route>
      <Route path="/payroll/audit">
        {user ? <PermissionGuard allowedRoles={["admin", "billing-admin"]}><PayrollAudit /></PermissionGuard> : <Redirect to="/login" />}
      </Route>
      {/* Fallback to 404 */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="light">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
