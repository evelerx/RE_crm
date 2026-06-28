import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api } from "../api/client";

type NotificationRow = {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string;
  read_at: string | null;
  created_at: string;
};

function kindLabel(kind: string) {
  if (kind === "deal_closed") return "Deal closed";
  if (kind === "task_assigned") return "New task";
  if (kind === "message") return "Message";
  if (kind === "leaderboard_rank" || kind === "leaderboard_score") return "Leaderboard";
  return "Update";
}

function relativeTime(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function InboxPage() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const rows = await api<NotificationRow[]>("/notifications");
      setNotifications(rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load notifications");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const unreadCount = notifications.filter((row) => !row.read_at).length;

  async function openNotification(row: NotificationRow) {
    if (!row.read_at) {
      setNotifications((prev) => prev.map((item) => (item.id === row.id ? { ...item, read_at: new Date().toISOString() } : item)));
      try {
        await api(`/notifications/${row.id}/read`, { method: "POST" });
      } catch {
        // Non-critical; the feed will self-correct on next poll.
      }
    }
    if (row.link) navigate(row.link);
  }

  async function markAllRead() {
    try {
      await api("/notifications/read-all", { method: "POST" });
      setNotifications((prev) => prev.map((item) => ({ ...item, read_at: item.read_at || new Date().toISOString() })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to mark notifications read");
    }
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">Inbox</div>
          <div className="muted">Deal closures, task assignments, messages, and leaderboard updates land here.</div>
        </div>
        <div className="row">
          {unreadCount > 0 ? (
            <button className="btn ghost" type="button" onClick={() => void markAllRead()}>
              Mark all read
            </button>
          ) : null}
          <button className="btn ghost" type="button" onClick={() => void load()}>
            Refresh
          </button>
        </div>
      </div>

      {error ? <div className="alert">{error}</div> : null}

      <section className="card">
        <div className="list">
          {loading ? <div className="muted">Loading...</div> : null}
          {!loading && notifications.length === 0 ? (
            <div className="emptyStateCard">
              <div className="h2">Nothing yet</div>
              <div className="muted">You'll see deal closures, new tasks, messages, and leaderboard moves here.</div>
            </div>
          ) : null}
          {!loading &&
            notifications.map((row) => (
              <button
                key={row.id}
                type="button"
                className={`listItem${row.read_at ? "" : " feedRowNew"}`}
                style={{ textAlign: "left", width: "100%", cursor: row.link ? "pointer" : "default" }}
                onClick={() => void openNotification(row)}
              >
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div>
                    <span className="pill" style={{ marginRight: 8 }}>{kindLabel(row.kind)}</span>
                    <b>{row.title}</b>
                    {row.body ? <div className="muted small">{row.body}</div> : null}
                  </div>
                  <div className="muted small">{relativeTime(row.created_at)}</div>
                </div>
              </button>
            ))}
        </div>
      </section>
    </div>
  );
}
