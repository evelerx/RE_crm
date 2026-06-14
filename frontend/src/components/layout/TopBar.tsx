// MODIFIED: Part 4 — Shared top bar — Adds route-aware title, breadcrumb, search shell, and action buttons across CRM/admin pages.
import { type ReactNode } from "react";

type TopBarProps = {
  title: string;
  breadcrumb: string;
  admin?: boolean;
  actions?: ReactNode;
};

export default function TopBar({ title, breadcrumb, admin = false, actions }: TopBarProps) {
  return (
    <header className={`shellTopBar${admin ? " adminTopBarTheme" : ""}`}>
      <div className="shellTopBarCopy">
        <div className="shellTopBarTitle">{title}</div>
        <div className="shellTopBarBreadcrumb">{breadcrumb}</div>
      </div>

      <div className="shellTopBarSpacer" />

      <label className="shellSearch">
        <span className="shellSearchIcon" aria-hidden="true">SR</span>
        <input aria-label="Search contacts, deals, and records" placeholder="Search contacts, deals..." />
      </label>

      <button className="shellIconButton" type="button" title="Notifications">
        NT
      </button>
      <button className="shellIconButton" type="button" title="Help">
        HP
      </button>
      <div className="shellTopBarDivider" />
      {actions}
    </header>
  );
}
