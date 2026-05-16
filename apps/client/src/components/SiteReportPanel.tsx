import { useMemo, useState } from "react";

import type { AppMatchState } from "../clientTypes";
import { API_BASE_URL } from "../config";

type SiteReportSeverity = "LOW" | "NORMAL" | "HIGH" | "BLOCKING";

type SiteReportPanelProps = {
  activePage: string;
  match?: AppMatchState | null;
};

type SiteReportResponse = {
  ticket?: {
    id: string;
    createdAt: string;
  };
  message?: string;
};

function getViewportContext(): Record<string, unknown> {
  return {
    path: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
    userAgent: navigator.userAgent,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio
    }
  };
}

export function SiteReportPanel({ activePage, match }: SiteReportPanelProps) {
  const defaultSubject = useMemo(
    () => `Site report: ${activePage}`,
    [activePage]
  );
  const [subject, setSubject] = useState(defaultSubject);
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<SiteReportSeverity>("NORMAL");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState("");
  const [submitError, setSubmitError] = useState("");

  async function submitReport() {
    const trimmedSubject = subject.trim();
    const trimmedDescription = description.trim();

    if (!trimmedSubject || !trimmedDescription) {
      setSubmitError("Add a subject and a short description before sending the report.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError("");
    setSubmitMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/support-tickets/site-report`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          matchId: match?.matchId,
          currentPage: activePage,
          subject: trimmedSubject,
          description: trimmedDescription,
          severity,
          clientContext: getViewportContext()
        })
      });
      const payload = await response.json().catch(() => ({})) as SiteReportResponse;

      if (!response.ok) {
        throw new Error(payload.message ?? "Unable to send report.");
      }

      setSubmitMessage(payload.ticket?.id ? `Report sent: ${payload.ticket.id}` : "Report sent.");
      setDescription("");
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Unable to send report.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="card board-report-card">
      <div className="board-report-summary">
        <div>
          <span>Page</span>
          <strong>{activePage}</strong>
        </div>
        <div>
          <span>URL</span>
          <strong>{window.location.pathname}{window.location.search}</strong>
        </div>
        <div>
          <span>Match</span>
          <strong>{match?.matchId ?? "None"}</strong>
        </div>
      </div>

      <form
        className="board-report-form"
        onSubmit={event => {
          event.preventDefault();
          void submitReport();
        }}
      >
        <label>
          Subject
          <input
            value={subject}
            maxLength={140}
            onChange={event => setSubject(event.target.value)}
          />
        </label>

        <label>
          Severity
          <select value={severity} onChange={event => setSeverity(event.target.value as SiteReportSeverity)}>
            <option value="LOW">Low</option>
            <option value="NORMAL">Normal</option>
            <option value="HIGH">High</option>
            <option value="BLOCKING">Blocking</option>
          </select>
        </label>

        <label>
          What happened?
          <textarea
            value={description}
            maxLength={2400}
            rows={7}
            onChange={event => setDescription(event.target.value)}
          />
        </label>

        {submitError ? <p className="error-box">{submitError}</p> : null}
        {submitMessage ? <p className="success-box">{submitMessage}</p> : null}

        <div className="board-report-actions">
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Sending..." : "Send Report"}
          </button>
        </div>
      </form>
    </section>
  );
}
