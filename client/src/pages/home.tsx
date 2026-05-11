import { useEffect } from "react";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout/layout";
import { Aurora } from "@/components/aurora";
import { Button } from "@/components/ui/button";
import {
  Calculator,
  Receipt,
  Brain,
  FileBarChart,
  AlertTriangle,
  Cloud,
  ArrowRight,
  ChevronRight,
  Star,
  Shield,
  Users,
  Zap,
  Blocks,
} from "lucide-react";
import heroImage from "@assets/AdobeStock_244105520_1771187192557.jpeg";
import secondaryImage from "@assets/AdobeStock_189127184_1771187213585.jpeg";

const features = [
  {
    icon: Calculator,
    title: "Project Estimates",
    description:
      "Build detailed, multi-phase estimates with hierarchical rate precedence, Excel/CSV import/export, and AI-generated narratives. From T&M to retainer engagements, Constellation handles it all.",
    highlight: true,
    color: "from-violet-500 to-purple-600",
    lightColor: "bg-violet-50 dark:bg-violet-950/40",
    iconColor: "text-violet-600 dark:text-violet-400",
  },
  {
    icon: Receipt,
    title: "Expense Management",
    description:
      "Complete expense lifecycle with approval workflows, automated per diem calculations (CONUS & OCONUS), receipt management, and contractor reimbursement invoicing.",
    highlight: false,
    color: "from-emerald-500 to-teal-600",
    lightColor: "bg-emerald-50 dark:bg-emerald-950/40",
    iconColor: "text-emerald-600 dark:text-emerald-400",
  },
  {
    icon: Blocks,
    title: "Microsoft 365 Integration",
    description:
      "SharePoint Embedded for secure, private document storage per organization. Outlook for email notifications, Planner for automatic task synchronization, and Azure AD for enterprise single sign-on.",
    highlight: false,
    color: "from-blue-500 to-cyan-600",
    lightColor: "bg-blue-50 dark:bg-blue-950/40",
    iconColor: "text-blue-600 dark:text-blue-400",
  },
  {
    icon: Brain,
    title: "AI-Powered Intelligence",
    description:
      "Powered by Azure AI Foundry with advanced models including GPT-5.4. AI-generated estimate narratives, status reports, invoice descriptions, and smart insights that accelerate your consulting practice.",
    highlight: false,
    color: "from-amber-500 to-orange-600",
    lightColor: "bg-amber-50 dark:bg-amber-950/40",
    iconColor: "text-amber-600 dark:text-amber-400",
  },
  {
    icon: FileBarChart,
    title: "Status Reports & Financials",
    description:
      "Comprehensive financial reporting with revenue, cost, profit, and margin analysis by client and project. KPI dashboards and project health scoring at a glance.",
    highlight: false,
    color: "from-rose-500 to-pink-600",
    lightColor: "bg-rose-50 dark:bg-rose-950/40",
    iconColor: "text-rose-600 dark:text-rose-400",
  },
  {
    icon: AlertTriangle,
    title: "Risk & Issue Management",
    description:
      "Track risks, actions, issues, decisions, and dependencies (RAIDD) at both portfolio and project levels. Stay ahead of problems before they impact delivery.",
    highlight: false,
    color: "from-sky-500 to-indigo-600",
    lightColor: "bg-sky-50 dark:bg-sky-950/40",
    iconColor: "text-sky-600 dark:text-sky-400",
  },
];

const capabilities = [
  {
    icon: Shield,
    title: "Multi-Tenant Isolation",
    description: "Complete data isolation across organizations with role-based access control.",
  },
  {
    icon: Users,
    title: "Resource Planning",
    description: "Capacity planning with timeline views, conflict detection, and utilization tracking.",
  },
  {
    icon: Cloud,
    title: "Cloud-Native Platform",
    description: "Modern SaaS architecture with Azure AD SSO and enterprise-grade security.",
  },
  {
    icon: Zap,
    title: "Automated Workflows",
    description: "Scheduled jobs, email reminders, and automated invoice generation.",
  },
];

function trackPageView(path: string) {
  try {
    let sid = sessionStorage.getItem("anon_session_id");
    if (!sid) { sid = crypto.randomUUID(); sessionStorage.setItem("anon_session_id", sid); }
    fetch("/api/analytics/pageview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, sessionId: sid, referrer: document.referrer }),
    }).catch(() => {});
  } catch {}
}

export default function Home() {
  const [, navigate] = useLocation();

  useEffect(() => { trackPageView("/"); }, []);

  return (
    <Layout>
      <div className="space-y-0 -m-6">
        {/* Hero Section */}
        <div className="relative overflow-hidden rounded-b-2xl">
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${heroImage})` }}
          />
          <Aurora intensity="medium" theme="dark" particles className="z-[1]" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/60 to-black/40 z-[2]" />
          <div className="relative z-[3] px-8 py-20 lg:py-28 max-w-4xl">
            <div className="flex items-center gap-2 mb-4">
              <Star className="w-5 h-5 text-amber-400 fill-amber-400" />
              <span className="text-amber-300 text-sm font-medium tracking-wide uppercase">
                Consulting Delivery Platform
              </span>
            </div>
            <h1 className="text-4xl lg:text-5xl xl:text-6xl font-bold text-white leading-tight mb-6">
              Navigate Your Projects
              <br />
              <span className="cosmic-text">
                Like the Stars
              </span>
            </h1>
            <p className="text-lg lg:text-xl text-gray-300 max-w-2xl mb-8 leading-relaxed">
              Constellation brings clarity to consulting delivery. From detailed
              project estimates to automated invoicing, manage your entire
              practice with precision and intelligence.
            </p>
            <div className="flex flex-wrap gap-4">
              <Button
                size="lg"
                onClick={() => navigate("/dashboard")}
                className="bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 text-white px-8 py-3 text-base font-semibold shadow-lg shadow-violet-500/25"
              >
                Go to Dashboard
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => navigate("/projects")}
                className="border-white/30 text-white hover:bg-white/10 px-8 py-3 text-base font-semibold"
              >
                View Estimates
              </Button>
            </div>
          </div>
        </div>

        {/* Features Grid */}
        <div className="px-6 py-16">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold cosmic-text mb-3">
              Everything You Need to Deliver Excellence
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Purpose-built for consulting firms, Constellation covers every
              aspect of project delivery and financial management.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
            {features.map((feature, idx) => {
              const Icon = feature.icon;
              const staggerClass = `stagger-${Math.min(idx + 1, 6)}`;
              return (
                <div
                  key={feature.title}
                  className={`nebula-card group relative rounded-xl border border-border/60 p-6 transition-all duration-300 hover:shadow-xl hover:shadow-black/5 dark:hover:shadow-black/20 hover:-translate-y-1 animate-fade-in-up ${staggerClass} ${
                    feature.highlight
                      ? "ring-2 ring-violet-500/30 dark:ring-violet-400/20 bg-gradient-to-br from-violet-50/50 to-purple-50/30 dark:from-violet-950/30 dark:to-purple-950/20"
                      : "bg-card hover:bg-accent/30"
                  }`}
                >
                  {feature.highlight && (
                    <div className="absolute -top-3 left-6">
                      <span className="bg-gradient-to-r from-violet-600 to-purple-600 text-white text-xs font-semibold px-3 py-1 rounded-full">
                        Core Feature
                      </span>
                    </div>
                  )}
                  <div
                    className={`w-12 h-12 rounded-xl ${feature.lightColor} flex items-center justify-center mb-4`}
                  >
                    <Icon className={`w-6 h-6 ${feature.iconColor}`} />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-2">
                    {feature.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Estimates Spotlight Section */}
        <div className="relative overflow-hidden">
          <div
            className="absolute inset-0 bg-cover bg-center opacity-15 dark:opacity-10"
            style={{ backgroundImage: `url(${secondaryImage})` }}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/95 to-background/90" />
          <div className="relative z-10 px-6 py-16">
            <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <Calculator className="w-5 h-5 text-violet-500" />
                  <span className="text-violet-500 dark:text-violet-400 text-sm font-semibold tracking-wide uppercase">
                    Spotlight
                  </span>
                </div>
                <h2 className="text-3xl font-bold text-foreground mb-4">
                  Project Estimates That Win Work
                </h2>
                <p className="text-muted-foreground text-base leading-relaxed mb-6">
                  Constellation's estimation engine is purpose-built for
                  consulting firms. Create detailed, multi-phase estimates with
                  sophisticated rate hierarchies, resource planning, and
                  AI-powered narrative generation.
                </p>
                <ul className="space-y-3 mb-8">
                  {[
                    "Multi-phase estimates with epics, stages, and line items",
                    "Hierarchical rate precedence (Project > User > Organization)",
                    "Excel/CSV import/export with template support",
                    "AI-generated narratives and text export",
                    "Status-based locking and approval workflows",
                    "T&M, Fixed Price, and Retainer estimate types",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-3">
                      <ChevronRight className="w-4 h-4 text-violet-500 mt-1 flex-shrink-0" />
                      <span className="text-sm text-foreground/80">{item}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  onClick={() => navigate("/projects")}
                  className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white"
                >
                  Explore Estimates
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
              <div className="relative">
                <div className="rounded-2xl overflow-hidden shadow-2xl shadow-black/20 border border-border/50">
                  <img
                    src={secondaryImage}
                    alt="Constellation platform"
                    className="w-full h-auto object-cover"
                  />
                </div>
                <div className="absolute -bottom-4 -left-4 bg-card border border-border rounded-xl p-4 shadow-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                      <Zap className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">AI-Powered</p>
                      <p className="text-xs text-muted-foreground">Smart narratives & insights</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Platform Capabilities */}
        <div className="px-6 py-16 bg-muted/30">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-10">
              <h2 className="text-2xl font-bold text-foreground mb-3">
                Built for Enterprise Consulting
              </h2>
              <p className="text-muted-foreground max-w-xl mx-auto">
                Security, scalability, and automation designed for professional
                services organizations.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {capabilities.map((cap) => {
                const Icon = cap.icon;
                return (
                  <div
                    key={cap.title}
                    className="text-center p-6 rounded-xl bg-card border border-border/50 hover:border-primary/30 transition-colors"
                  >
                    <div className="w-12 h-12 mx-auto rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                      <Icon className="w-6 h-6 text-primary" />
                    </div>
                    <h3 className="font-semibold text-foreground mb-2">
                      {cap.title}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {cap.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* CTA Footer */}
        <div className="px-6 py-12 text-center">
          <h2 className="text-2xl font-bold text-foreground mb-3">
            Ready to Get Started?
          </h2>
          <p className="text-muted-foreground mb-6 max-w-lg mx-auto">
            Jump into your dashboard to manage projects, create estimates, and
            track your consulting practice.
          </p>
          <div className="flex justify-center gap-4 flex-wrap">
            <Button
              size="lg"
              onClick={() => navigate("/dashboard")}
              className="bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 text-white px-8"
            >
              Open Dashboard
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => navigate("/user-guide")}
            >
              View User Guide
            </Button>
          </div>
        </div>
      </div>
    </Layout>
  );
}
