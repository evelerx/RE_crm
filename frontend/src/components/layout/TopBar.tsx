// MODIFIED: Part 4 — Shared top bar — Adds route-aware title, breadcrumb, notification panel, and WhatsApp help.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { api } from "../../api/client";

type NotifActivity = { id: string; summary: string; due_at: string | null; kind: string; overdue: boolean };
type NextActionsSnippet = { overdue: Omit<NotifActivity, "overdue">[]; upcoming: Omit<NotifActivity, "overdue">[] };

type TopBarProps = {
  title: string;
  breadcrumb: string;
  admin?: boolean;
  actions?: ReactNode;
};

export default function TopBar({ title, breadcrumb, admin = false, actions }: TopBarProps) {
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifItems, setNotifItems] = useState<NotifActivity[]>([]);
  const [overdueCount, setOverdueCount] = useState(0);
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<NextActionsSnippet>("/next-actions?days=7")
      .then((data) => {
        setOverdueCount(data.overdue.length);
        setNotifItems([
          ...data.overdue.map((a) => ({ ...a, overdue: true })),
          ...data.upcoming.map((a) => ({ ...a, overdue: false })),
        ].slice(0, 20));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!notifOpen) return;
    function handleOutside(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [notifOpen]);

  function fmtDue(due: string | null) {
    if (!due) return "";
    return new Date(due).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  }

  return (
    <header className={`shellTopBar${admin ? " adminTopBarTheme" : ""}`}>
      <div className="shellTopBarCopy">
        <div className="shellTopBarTitle">{title}</div>
        <div className="shellTopBarBreadcrumb">{breadcrumb}</div>
      </div>

      <div className="shellTopBarSpacer" />

      <label className="shellSearch">
        <span className="shellSearchIcon" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </span>
        <input aria-label="Search contacts, deals, and records" placeholder="Search contacts, deals..." />
      </label>

      <div className="shellTopBarActions" ref={notifRef} style={{ position: "relative", display: "flex", gap: 6, alignItems: "center" }}>
        <button
          className="shellIconButton"
          type="button"
          title={overdueCount > 0 ? `${overdueCount} overdue task${overdueCount > 1 ? "s" : ""}` : "Notifications"}
          onClick={() => setNotifOpen((v) => !v)}
          style={{ position: "relative" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {overdueCount > 0 ? (
            <span style={{
              position: "absolute", top: -4, right: -4,
              minWidth: 16, height: 16, padding: "0 3px",
              borderRadius: 999, background: "#e06464", color: "#fff",
              fontSize: 10, fontWeight: 800, display: "flex",
              alignItems: "center", justifyContent: "center", lineHeight: 1,
              pointerEvents: "none",
            }}>
              {overdueCount > 9 ? "9+" : overdueCount}
            </span>
          ) : null}
        </button>

        <a
          className="shellIconButton"
          href="https://wa.me/919834241892"
          target="_blank"
          rel="noopener noreferrer"
          title="Help via WhatsApp"
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.978-1.414A9.955 9.955 0 0 0 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm4.93 13.144c-.207.578-1.21 1.107-1.66 1.15-.45.044-.877.2-2.96-.617-2.494-.983-4.103-3.524-4.228-3.688-.124-.165-1.015-1.35-1.015-2.576 0-1.226.64-1.83.868-2.082.228-.25.497-.313.662-.313.166 0 .33.002.475.008.152.007.357-.058.558.425.207.497.703 1.72.765 1.844.062.124.103.27.02.434-.082.165-.124.268-.248.413-.124.146-.26.326-.373.438-.124.124-.254.258-.11.506.145.248.644 1.062 1.383 1.72.95.846 1.752 1.108 2 1.232.248.124.393.103.538-.062.145-.165.62-.722.786-.97.165-.248.33-.207.558-.124.228.082 1.45.683 1.7.807.248.124.413.186.475.29.062.103.062.6-.145 1.177z"/>
          </svg>
        </a>

        {notifOpen ? (
          <div className="notifPanel">
            <div className="notifPanelHeader">
              Tasks &amp; Deadlines
              <NavLink to="/today" className="notifViewAll" onClick={() => setNotifOpen(false)}>View all →</NavLink>
            </div>
            {notifItems.length === 0 ? (
              <div className="muted small" style={{ padding: "10px 0" }}>No upcoming tasks or deadlines.</div>
            ) : notifItems.map((item) => (
              <NavLink key={item.id} to="/today" className={`notifItem${item.overdue ? " notifOverdue" : ""}`} onClick={() => setNotifOpen(false)}>
                <div className="notifItemSummary">{item.summary}</div>
                {item.due_at ? <div className="notifItemDue">{item.overdue ? "Overdue · " : ""}{fmtDue(item.due_at)}</div> : null}
              </NavLink>
            ))}
          </div>
        ) : null}
      </div>

      <div className="shellTopBarDivider" />
      {actions}
    </header>
  );
}
