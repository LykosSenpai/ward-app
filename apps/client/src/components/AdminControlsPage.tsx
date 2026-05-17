import { useEffect, useState } from "react";

import type {
  ServerFeatureFlag,
  SupportTicketDetail,
  SupportTicketStatus,
  SupportTicketSummary
} from "../clientTypes";
import { API_BASE_URL } from "../config";
import { ModalPanel } from "./ui/ModalPanel";

type Props = {
  features: ServerFeatureFlag[];
  onToggleFeature: (key: ServerFeatureFlag["key"], enabledForPlayers: boolean) => Promise<void>;
};

const SUPPORT_TICKET_STATUSES: SupportTicketStatus[] = ["OPEN", "TRIAGED", "RESOLVED", "DISMISSED"];

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value;
}

function formatReporter(ticket: SupportTicketSummary | SupportTicketDetail): string {
  return ticket.reporterDisplayName || ticket.reporterUsername || ticket.reporterUserId || "Unknown";
}

function getTicketSummary(ticket: SupportTicketDetail | null): string {
  if (!ticket) return "";
  return JSON.stringify(
    {
      category: ticket.category,
      matchId: ticket.matchId ?? null,
      status: ticket.status,
      severity: ticket.severity,
      reporter: formatReporter(ticket),
      createdAt: ticket.createdAt,
      clientContext: ticket.clientContext
    },
    null,
    2
  );
}

function sanitizeFilePart(value: string, fallback: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return sanitized || fallback;
}

function downloadJsonFile(fileName: string, contents: unknown): void {
  const blob = new Blob([`${JSON.stringify(contents, null, 2)}\n`], {
    type: "application/json;charset=utf-8"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function getTicketExportFileName(ticket: SupportTicketDetail): string {
  const subject = sanitizeFilePart(ticket.subject, "support-ticket").slice(0, 56);
  return `ward-support-ticket-${ticket.id}-${subject}.json`;
}

function buildTicketExport(ticket: SupportTicketDetail): Record<string, unknown> {
  return {
    exportVersion: 1,
    exportedAt: new Date().toISOString(),
    app: "Ward Nexus",
    ticket
  };
}

export function AdminControlsPage({ features, onToggleFeature }: Props) {
  const [tickets, setTickets] = useState<SupportTicketSummary[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<SupportTicketDetail | null>(null);
  const [ticketStatusFilter, setTicketStatusFilter] = useState<SupportTicketStatus | "ALL">("OPEN");
  const [ticketMessage, setTicketMessage] = useState("");
  const [ticketError, setTicketError] = useState("");
  const [ticketsBusy, setTicketsBusy] = useState(false);
  const [supportTicketsCollapsed, setSupportTicketsCollapsed] = useState(false);

  useEffect(() => {
    void loadTickets();
  }, [ticketStatusFilter]);

  async function loadTickets() {
    setTicketsBusy(true);
    setTicketError("");

    try {
      const params = new URLSearchParams();
      if (ticketStatusFilter !== "ALL") params.set("status", ticketStatusFilter);

      const response = await fetch(`${API_BASE_URL}/api/support-tickets${params.toString() ? `?${params}` : ""}`, {
        credentials: "include"
      });
      const data = await response.json() as { tickets?: SupportTicketSummary[]; message?: string };

      if (!response.ok || !data.tickets) {
        throw new Error(data.message ?? "Unable to load support tickets.");
      }

      setTickets(data.tickets);
      if (selectedTicket && !data.tickets.some(ticket => ticket.id === selectedTicket.id)) {
        setSelectedTicket(null);
      }
    } catch (error) {
      setTicketError(error instanceof Error ? error.message : "Unable to load support tickets.");
    } finally {
      setTicketsBusy(false);
    }
  }

  async function loadTicketDetail(ticketId: string) {
    setTicketsBusy(true);
    setTicketError("");
    setTicketMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/support-tickets/${encodeURIComponent(ticketId)}`, {
        credentials: "include"
      });
      const data = await response.json() as { ticket?: SupportTicketDetail; message?: string };

      if (!response.ok || !data.ticket) {
        throw new Error(data.message ?? "Unable to load support ticket.");
      }

      setSelectedTicket(data.ticket);
    } catch (error) {
      setTicketError(error instanceof Error ? error.message : "Unable to load support ticket.");
    } finally {
      setTicketsBusy(false);
    }
  }

  async function updateTicketStatus(ticketId: string, status: SupportTicketStatus) {
    setTicketsBusy(true);
    setTicketError("");
    setTicketMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/support-tickets/${encodeURIComponent(ticketId)}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ status })
      });
      const data = await response.json() as { ticket?: SupportTicketDetail; message?: string };

      if (!response.ok || !data.ticket) {
        throw new Error(data.message ?? "Unable to update support ticket.");
      }

      setSelectedTicket(data.ticket);
      setTickets(current => current.map(ticket => ticket.id === data.ticket!.id ? data.ticket! : ticket));
      setTicketMessage(`Ticket marked ${status}.`);
    } catch (error) {
      setTicketError(error instanceof Error ? error.message : "Unable to update support ticket.");
    } finally {
      setTicketsBusy(false);
    }
  }

  function downloadSelectedTicket() {
    if (!selectedTicket) return;

    downloadJsonFile(
      getTicketExportFileName(selectedTicket),
      buildTicketExport(selectedTicket)
    );
    setTicketMessage("Downloaded support ticket JSON.");
  }

  return (
    <section className="panel admin-controls-page">
      <h2>Admin Controls</h2>

      <section className={supportTicketsCollapsed ? "admin-controls-section admin-support-section is-collapsed" : "admin-controls-section admin-support-section"}>
        <div className="admin-controls-section-header">
          <div className="admin-controls-section-title">
            <h3>Support Tickets</h3>
            <span>{tickets.length} shown</span>
          </div>
          <div className="admin-ticket-toolbar">
            <select
              value={ticketStatusFilter}
              onChange={event => setTicketStatusFilter(event.target.value as SupportTicketStatus | "ALL")}
            >
              <option value="OPEN">Open</option>
              <option value="TRIAGED">Triaged</option>
              <option value="RESOLVED">Resolved</option>
              <option value="DISMISSED">Dismissed</option>
              <option value="ALL">All</option>
            </select>
            <button type="button" onClick={() => void loadTickets()} disabled={ticketsBusy}>
              Refresh
            </button>
            <button
              type="button"
              aria-expanded={!supportTicketsCollapsed}
              aria-controls="admin-support-ticket-panel"
              onClick={() => setSupportTicketsCollapsed(collapsed => !collapsed)}
            >
              {supportTicketsCollapsed ? "Open" : "Collapse"}
            </button>
          </div>
        </div>

        {supportTicketsCollapsed ? null : (
          <div id="admin-support-ticket-panel" className="admin-support-ticket-panel">
            {ticketError ? <p className="error-box">{ticketError}</p> : null}
            {ticketMessage ? <p className="success-box">{ticketMessage}</p> : null}

            <div className="admin-ticket-layout">
              <section className="admin-ticket-pane admin-ticket-list-pane" aria-label="Support ticket list">
                <div className="admin-ticket-pane-header">
                  <div>
                    <h4>Ticket Queue</h4>
                    <span>{ticketStatusFilter === "ALL" ? "All statuses" : ticketStatusFilter}</span>
                  </div>
                  <strong>{tickets.length}</strong>
                </div>

                <div className="admin-ticket-list">
                  {tickets.length === 0 ? (
                    <p className="empty-zone">{ticketsBusy ? "Loading tickets..." : "No tickets found."}</p>
                  ) : tickets.map(ticket => (
                    <button
                      key={ticket.id}
                      type="button"
                      className={selectedTicket?.id === ticket.id ? "admin-ticket-row is-selected" : "admin-ticket-row"}
                      onClick={() => void loadTicketDetail(ticket.id)}
                    >
                      <span className={`admin-ticket-status admin-ticket-status-${ticket.status.toLowerCase()}`}>{ticket.status}</span>
                      <strong>{ticket.subject}</strong>
                      <span>{ticket.category === "SITE_REPORT" ? "Site" : "Board"} / {ticket.severity} / {formatReporter(ticket)}</span>
                      <small>{formatDate(ticket.createdAt)}</small>
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </div>
        )}
      </section>

      {selectedTicket ? (
        <ModalPanel
          title="Support Ticket"
          onClose={() => setSelectedTicket(null)}
          wide
        >
          <div className="admin-ticket-detail admin-ticket-detail-window">
            <div className="admin-ticket-detail-header">
              <div>
                <h3>{selectedTicket.subject}</h3>
                <p>{selectedTicket.id}</p>
              </div>
              <span className={`admin-ticket-status admin-ticket-status-${selectedTicket.status.toLowerCase()}`}>{selectedTicket.status}</span>
            </div>

            <div className="admin-ticket-meta">
              <span>Reporter</span>
              <strong>{formatReporter(selectedTicket)}</strong>
              <span>Category</span>
              <strong>{selectedTicket.category === "SITE_REPORT" ? "Site Report" : "Board Report"}</strong>
              <span>Match</span>
              <strong>{selectedTicket.matchId ?? "None"}</strong>
              <span>Severity</span>
              <strong>{selectedTicket.severity}</strong>
              <span>Created</span>
              <strong>{formatDate(selectedTicket.createdAt)}</strong>
            </div>

            <p className="admin-ticket-description">{selectedTicket.description}</p>

            <div className="admin-ticket-actions">
              <button
                type="button"
                onClick={downloadSelectedTicket}
                disabled={ticketsBusy}
              >
                Download JSON
              </button>
              {SUPPORT_TICKET_STATUSES.map(status => (
                <button
                  key={status}
                  type="button"
                  disabled={ticketsBusy || selectedTicket.status === status}
                  onClick={() => void updateTicketStatus(selectedTicket.id, status)}
                >
                  {status}
                </button>
              ))}
            </div>

            <details className="admin-ticket-json">
              <summary>Context</summary>
              <pre>{getTicketSummary(selectedTicket)}</pre>
            </details>

            <details className="admin-ticket-json">
              <summary>{selectedTicket.category === "SITE_REPORT" ? "Report Snapshot" : "Match Snapshot"}</summary>
              <pre>{JSON.stringify(selectedTicket.matchSnapshot, null, 2)}</pre>
            </details>
          </div>
        </ModalPanel>
      ) : null}

      <section className="admin-controls-section">
        <div className="admin-controls-section-header">
          <h3>Feature Rollout</h3>
        </div>
        <div className="admin-feature-grid">
          {features.map(feature => (
            <label
              className={`admin-feature-chip${feature.enabledForPlayers ? " is-enabled" : ""}${feature.adminOnly ? " is-locked" : ""}`}
              key={feature.key}
              title={feature.description}
            >
              <input
                type="checkbox"
                checked={feature.enabledForPlayers}
                disabled={feature.adminOnly}
                onChange={event => { void onToggleFeature(feature.key, event.currentTarget.checked); }}
              />
              <span>{feature.label}</span>
            </label>
          ))}
        </div>
      </section>
    </section>
  );
}
