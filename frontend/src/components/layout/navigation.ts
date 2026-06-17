// MODIFIED: Parts 2-6 — Shared route metadata and sidebar definitions — Keeps CRM and admin shells consistent and maps every admin nav item to a real section anchor.
export type NavItem = {
  label: string;
  to: string;
  icon: string;
  badge?: string;
  external?: boolean;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export function crmNavGroups(options: { isAdmin: boolean; isOwnerLike: boolean }) {
  const groups: NavGroup[] = [
    {
      label: "Workspace",
      items: [
        { label: "Dashboard", to: "/today", icon: "DB" },
        { label: "Pipeline", to: "/", icon: "PL" },
        { label: "Contacts", to: "/contacts", icon: "CT" },
        { label: "Deals", to: "/deals", icon: "DL" },
        { label: "Properties", to: "/properties", icon: "PR" },
      ],
    },
    {
      label: "Channels",
      items: [
        { label: "WhatsApp", to: "/whatsapp", icon: "WA" },
        { label: "Inbox", to: "/inbox", icon: "IN" },
        { label: "Calls", to: "/calls", icon: "CL" },
        { label: "Apps", to: "/apps", icon: "AP" },
        { label: "Ads", to: "/ads", icon: "AD" },
      ],
    },
    {
      label: "Intelligence",
      items: [
        { label: "AI Workbench", to: "/enterprise#ai-workbench", icon: "AI" },
        { label: "Lead Scoring", to: "/enterprise#ai-deal-intelligence", icon: "LS" },
        { label: "Leaderboard", to: "/leaderboard", icon: "LB" },
        { label: "ROI Insights", to: "/insights", icon: "RI" },
        { label: "ROI Calculator", to: "/calc", icon: "RC" },
      ],
    },
  ];

  if (options.isOwnerLike) {
    groups.push({
      label: "Enterprise",
      items: [
        { label: "Team IDs", to: "/enterprise", icon: "TM" },
        { label: "AI Docs", to: "/enterprise#ai-builder-documents", icon: "DC" },
        { label: "Builder Site", to: "/enterprise#ai-builder-website", icon: "WB" },
        { label: "Automations", to: "/automations", icon: "AT" },
        { label: "Webhooks", to: "/webhooks", icon: "WH" },
        { label: "Inventory", to: "/inventory", icon: "IV" },
        { label: "Targets", to: "/targets", icon: "TG" },
        { label: "Sequences", to: "/sequences", icon: "SQ" },
      ],
    });
  }

  groups.push({
    label: "Profile",
    items: [
      { label: "My Profile", to: "/account", icon: "AC" },
      { label: "Settings", to: "/settings", icon: "ST" },
    ],
  });

  if (options.isAdmin) {
    groups.push({
      label: "Admin",
      items: [{ label: "Admin Portal", to: "/admin#admin-dashboard", icon: "AD" }],
    });
  }

  return groups;
}

export const adminNavGroups: NavGroup[] = [
  {
    label: "Overview",
    items: [{ label: "Dashboard", to: "/admin#admin-dashboard", icon: "DB" }],
  },
  {
    label: "Tenants",
    items: [
      { label: "Organizations", to: "/admin#admin-organization", icon: "OG" },
      { label: "User Accounts", to: "/admin#admin-users", icon: "US" },
    ],
  },
  {
    label: "Commercial",
    items: [
      { label: "Subscriptions", to: "/admin#admin-subscriptions", icon: "SB" },
      { label: "Razorpay Txns", to: "/admin#admin-transactions", icon: "TX" },
      { label: "Demo Accounts", to: "/admin#admin-demo-accounts", icon: "DM" },
      { label: "Revenue", to: "/admin#admin-revenue", icon: "RV" },
      { label: "Marketing Accounts", to: "/admin#admin-marketing-accounts", icon: "MK" },
    ],
  },
  {
    label: "Governance",
    items: [
      { label: "RBAC Matrix", to: "/admin#admin-rbac", icon: "RB" },
      { label: "Feature Flags", to: "/admin#admin-flags", icon: "FF" },
      { label: "AI Allocation", to: "/admin#admin-ai-allocation", icon: "AI" },
      { label: "CRM Settings", to: "/admin#admin-settings", icon: "CS" },
      { label: "Compliance", to: "/admin#admin-compliance", icon: "CM" },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Lead Ingestion", to: "/admin#admin-lead-ingestion", icon: "LI" },
      { label: "Background Jobs", to: "/admin#admin-jobs", icon: "JB" },
      { label: "API Usage", to: "/admin#admin-api-usage", icon: "AP" },
      { label: "Webhook Logs", to: "/admin#admin-logs", icon: "WL" },
      { label: "Enterprise", to: "/admin#admin-enterprise", icon: "EN" },
    ],
  },
  {
    label: "Security",
    items: [
      { label: "Audit Log", to: "/admin#admin-audit-log", icon: "AL" },
      { label: "Security Events", to: "/admin#admin-security", icon: "SE" },
      { label: "Locked Accounts", to: "/admin#admin-security", icon: "LK" },
    ],
  },
  {
    label: "Support",
    items: [
      { label: "Support Threads", to: "/admin#admin-support", icon: "SP" },
      { label: "Impersonation", to: "/admin#admin-impersonation", icon: "IM" },
    ],
  },
];

export function routeTitle(pathname: string) {
  if (pathname.startsWith("/admin")) return "Admin Portal";
  if (pathname === "/today") return "Dashboard";
  if (pathname === "/") return "Pipeline";
  if (pathname.startsWith("/deals")) return "Deals";
  if (pathname.startsWith("/contacts")) return "Contacts";
  if (pathname.startsWith("/properties")) return "Properties";
  if (pathname.startsWith("/whatsapp")) return "WhatsApp";
  if (pathname.startsWith("/inbox")) return "Inbox";
  if (pathname.startsWith("/calls")) return "Calls";
  if (pathname.startsWith("/ads")) return "Ads";
  if (pathname.startsWith("/leaderboard")) return "Leaderboard";
  if (pathname.startsWith("/calc")) return "ROI Calculator";
  if (pathname.startsWith("/targets")) return "Targets";
  if (pathname.startsWith("/sequences")) return "Sequences";
  if (pathname.startsWith("/enterprise")) return "Enterprise";
  if (pathname.startsWith("/automations")) return "Automations";
  if (pathname.startsWith("/webhooks")) return "Webhooks";
  if (pathname.startsWith("/inventory")) return "Inventory";
  if (pathname.startsWith("/integrations")) return "Integrations";
  if (pathname.startsWith("/insights")) return "ROI Insights";
  if (pathname.startsWith("/apps")) return "Apps";
  if (pathname.startsWith("/settings")) return "Settings";
  if (pathname.startsWith("/account")) return "Account";
  return "Workspace";
}

export function routeBreadcrumb(pathname: string) {
  if (pathname.startsWith("/admin")) return "Admin / Control Center";
  if (pathname.startsWith("/deals")) return "Workspace / Deals";
  if (pathname.startsWith("/contacts")) return "Workspace / Contacts";
  if (pathname.startsWith("/properties")) return "Workspace / Inventory";
  if (pathname.startsWith("/whatsapp")) return "Channels / WhatsApp";
  if (pathname.startsWith("/inbox")) return "Channels / Inbox";
  if (pathname.startsWith("/calls")) return "Channels / Calls";
  if (pathname.startsWith("/ads")) return "Channels / Ads";
  if (pathname.startsWith("/leaderboard")) return "Intelligence / Leaderboard";
  if (pathname.startsWith("/calc")) return "Intelligence / ROI Calculator";
  if (pathname.startsWith("/targets")) return "Team / Targets";
  if (pathname.startsWith("/sequences")) return "Team / Sequences";
  if (pathname.startsWith("/insights")) return "Intelligence / ROI Insights";
  if (pathname.startsWith("/automations")) return "Enterprise / Automations";
  if (pathname.startsWith("/webhooks")) return "Enterprise / Webhooks";
  if (pathname.startsWith("/inventory")) return "Enterprise / Inventory";
  if (pathname.startsWith("/integrations")) return "Settings / Integrations";
  return "Workspace / Dashboard";
}
