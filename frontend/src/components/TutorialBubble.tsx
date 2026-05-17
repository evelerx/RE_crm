import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

type TutorialStep = {
  id: string;
  title: string;
  description: string;
  bullets: string[];
  path?: string;
};

function routeMatches(pathname: string, path?: string) {
  if (!path) return false;
  if (path === "/") return pathname === "/";
  return pathname === path || pathname.startsWith(`${path}/`);
}

export default function TutorialBubble({
  isAdmin,
  isEnterprise,
  reraCompleted,
  email
}: {
  isAdmin: boolean;
  isEnterprise: boolean;
  reraCompleted: boolean;
  email: string;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const storageKey = `northstonecrm_tutorial_hidden_${email || "guest"}`;
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  const steps = useMemo<TutorialStep[]>(() => {
    const base: TutorialStep[] = [
      {
        id: "welcome",
        title: "Welcome to your CRM",
        description: "This quick guide helps clients understand where to work first and what each section is best used for.",
        bullets: [
          "Track every lead, contact, and follow-up from one place.",
          "Use the navigation tabs to move from pipeline work to reporting.",
          "You can skip this guide now and reopen it anytime from the Guide bubble."
        ],
        path: reraCompleted ? "/today" : "/account"
      },
      {
        id: "today",
        title: "Today view",
        description: "Start here to see what needs immediate attention.",
        bullets: [
          "Prioritize follow-ups and stale deals quickly.",
          "Review what actions are due today before opening the full pipeline.",
          "Use this page as the daily operating dashboard."
        ],
        path: "/today"
      },
      {
        id: "pipeline",
        title: "Pipeline",
        description: "This is the visual sales board for moving deals through stages.",
        bullets: [
          "Monitor deals in lead, visit, negotiation, closed, and lost stages.",
          "Spot bottlenecks quickly by looking at stage buildup.",
          "Use it for daily deal movement and stage-level progress."
        ],
        path: "/"
      },
      {
        id: "deals",
        title: "Deals",
        description: "Use the deals grid for structured tracking and cleanup.",
        bullets: [
          "Search, edit, and review detailed deal records.",
          "Track stage, city, area, ticket size, and notes.",
          "Open any deal to generate reports and AI-assisted outputs."
        ],
        path: "/deals"
      },
      {
        id: "contacts",
        title: "Contacts",
        description: "Store client and relationship data in one searchable list.",
        bullets: [
          "Keep buyer, investor, and channel partner records organized.",
          "Update contact details without losing deal context.",
          "Use this for relationship continuity across the team."
        ],
        path: "/contacts"
      },
      {
        id: "roi",
        title: "ROI tools",
        description: "Use this area to explain returns and investment assumptions clearly.",
        bullets: [
          "Calculate ROI and expected returns during investor discussions.",
          "Use it as a quick advisory tool in calls and meetings.",
          "Keep pricing conversations more structured and credible."
        ],
        path: "/calc"
      },
      {
        id: "insights",
        title: "Insights",
        description: "This page turns activity into measurable business visibility.",
        bullets: [
          "Review conversion, win rate, and stage performance.",
          "Use it to monitor output and decide where the team needs attention.",
          "Great for weekly reviews and sales performance check-ins."
        ],
        path: "/insights"
      },
      {
        id: "enterprise",
        title: "Organization workspace",
        description: "This is where Northstone shows team rollups, builder operations, company visibility, and organization-level controls.",
        bullets: [
          "Everyone can preview this workspace during onboarding and product walkthroughs.",
          "Enterprise and Builder subscriptions unlock live org controls, analytics, and team workflows.",
          "Locked actions point users toward upgrading instead of hiding the whole module."
        ],
        path: "/enterprise"
      },
      {
        id: "apps",
        title: "Apps",
        description: "Use Apps to show clients how Northstone will connect communication and meeting workflows over time.",
        bullets: [
          "Clients can preview Gmail, Teams, Zoom, Meet, Calendar, and Outlook connection options.",
          "This is the right place to explain future communication integrations during demos.",
          "Production OAuth and sync can be rolled out app by app."
        ],
        path: "/apps"
      },
      {
        id: "account",
        title: "Account setup",
        description: "Clients should complete account details early so the CRM is fully usable.",
        bullets: [
          "Finish profile and trust details first.",
          "This helps unlock smoother onboarding and cleaner records.",
          "Keep account information updated for better team visibility."
        ],
        path: "/account"
      },
      {
        id: "settings",
        title: "Settings",
        description: "Use settings for control and configuration, not daily operations.",
        bullets: [
          "Manage runtime configuration and operational preferences.",
          "Use this page carefully because settings affect the full workspace.",
          "Keep changes intentional and documented."
        ],
        path: "/settings"
      }
    ];

    if (isAdmin) {
      base.push({
        id: "admin",
        title: "Admin controls",
        description: "This area is for platform-wide monitoring and account governance.",
        bullets: [
          "Review user activity, enterprise accounts, and audit logs.",
          "Control plans, AI access, password resets, and account restrictions.",
          "Use the analytics panels for oversight, not routine sales work."
        ],
        path: "/admin"
      });
    }

    return base;
  }, [isAdmin, isEnterprise, reraCompleted]);

  useEffect(() => {
    const hidden = window.localStorage.getItem(storageKey) === "1";
    setOpen(!hidden);
  }, [storageKey]);

  useEffect(() => {
    const matchedIndex = steps.findIndex((step) => routeMatches(location.pathname, step.path));
    if (matchedIndex >= 0) {
      setStepIndex(matchedIndex);
    }
  }, [location.pathname, steps]);

  if (!steps.length) return null;

  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const isLast = stepIndex >= steps.length - 1;
  const isFirst = stepIndex <= 0;

  function handleOpen() {
    setOpen(true);
    window.localStorage.removeItem(storageKey);
  }

  function handleSkip() {
    window.localStorage.setItem(storageKey, "1");
    setOpen(false);
  }

  function goToIndex(nextIndex: number) {
    const bounded = Math.max(0, Math.min(steps.length - 1, nextIndex));
    setStepIndex(bounded);
    const nextStep = steps[bounded];
    if (nextStep?.path && !routeMatches(location.pathname, nextStep.path)) {
      navigate(nextStep.path);
    }
  }

  return (
    <>
      {!open ? (
        <button className="tutorialLauncher" type="button" onClick={handleOpen}>
          Guide
        </button>
      ) : null}
      {open ? (
        <aside className="tutorialBubble" aria-live="polite">
          <div className="tutorialMeta">
            <span className="tutorialEyebrow">Product Tour</span>
            <span className="tutorialCount">
              {stepIndex + 1} / {steps.length}
            </span>
          </div>
          <div className="tutorialTitle">{step.title}</div>
          <div className="tutorialText">{step.description}</div>
          <ul className="tutorialList">
            {step.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
          <div className="tutorialActions">
            <button className="btn ghost" type="button" onClick={() => goToIndex(stepIndex - 1)} disabled={isFirst}>
              Back
            </button>
            <button className="btn" type="button" onClick={() => (isLast ? handleSkip() : goToIndex(stepIndex + 1))}>
              {isLast ? "Finish" : "Next"}
            </button>
          </div>
          <button className="tutorialSkip" type="button" onClick={handleSkip}>
            Skip tutorial
          </button>
        </aside>
      ) : null}
    </>
  );
}
