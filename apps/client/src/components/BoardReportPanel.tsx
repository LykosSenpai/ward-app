import { useEffect, useMemo, useRef, useState } from "react";

import type { AppMatchState } from "../clientTypes";
import { API_BASE_URL } from "../config";

type BoardReportSeverity = "LOW" | "NORMAL" | "HIGH" | "BLOCKING";

type BoardReportPanelProps = {
  match: AppMatchState;
  onSubmitted?: () => void;
};

type BoardReportResponse = {
  ticket?: {
    id: string;
    createdAt: string;
  };
  message?: string;
};

function getPlayerName(match: AppMatchState, playerId: string): string {
  return match.players.find(player => player.id === playerId)?.displayName ?? playerId;
}

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

export function BoardReportPanel({ match, onSubmitted }: BoardReportPanelProps) {
  const defaultSubject = useMemo(
    () => `3D board report: turn ${match.turn.turnNumber} ${match.turn.phase}`,
    [match.turn.phase, match.turn.turnNumber]
  );
  const closeTimerRef = useRef<number | null>(null);
  const [subject, setSubject] = useState(defaultSubject);
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<BoardReportSeverity>("NORMAL");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submitMessage, setSubmitMessage] = useState("");
  const [submitError, setSubmitError] = useState("");

  useEffect(() => () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
  }, []);

  async function submitReport() {
    if (isSubmitting || isSubmitted) return;

    const trimmedSubject = subject.trim();
    const trimmedDescription = description.trim();

    if (!trimmedSubject || !trimmedDescription) {
      setSubmitError("Add a subject and a short description before sending the report.");
      return;
    }

    setIsSubmitting(true);
    setIsSubmitted(false);
    setSubmitError("");
    setSubmitMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/support-tickets/board-report`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          matchId: match.matchId,
          subject: trimmedSubject,
          description: trimmedDescription,
          severity,
          clientContext: getViewportContext()
        })
      });
      const payload = await response.json().catch(() => ({})) as BoardReportResponse;

      if (!response.ok) {
        throw new Error(payload.message ?? "Unable to send report.");
      }

      setSubmitMessage(payload.ticket?.id ? `Report sent: ${payload.ticket.id}` : "Report sent.");
      setDescription("");
      setIsSubmitted(true);

      closeTimerRef.current = window.setTimeout(() => {
        onSubmitted?.();
      }, 2000);
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
          <span>Match</span>
          <strong>{match.matchId}</strong>
        </div>
        <div>
          <span>Turn</span>
          <strong>{match.turn.turnNumber} / {match.turn.phase}</strong>
        </div>
        <div>
          <span>Active</span>
          <strong>{getPlayerName(match, match.turn.activePlayerId)}</strong>
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
          <select value={severity} onChange={event => setSeverity(event.target.value as BoardReportSeverity)}>
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
          <button type="submit" disabled={isSubmitting || isSubmitted}>
            {isSubmitting ? "Sending..." : isSubmitted ? "Sent" : "Send Report"}
          </button>
        </div>
      </form>
    </section>
  );
}
