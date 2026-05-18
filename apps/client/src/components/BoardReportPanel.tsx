import { useMemo, useState } from "react";

import type { AppMatchState } from "../clientTypes";

type BoardReportSeverity = "LOW" | "NORMAL" | "HIGH" | "BLOCKING";

export type QueuedBoardReport = {
  matchId: string;
  turnNumber: number;
  phase: string;
  activePlayerId: string;
  subject: string;
  description: string;
  severity: BoardReportSeverity;
  clientContext: Record<string, unknown>;
};

type BoardReportPanelProps = {
  match: AppMatchState;
  onQueued?: (report: QueuedBoardReport) => void;
  onSubmitted?: () => void;
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

export function BoardReportPanel({ match, onQueued, onSubmitted }: BoardReportPanelProps) {
  const defaultSubject = useMemo(
    () => `3D board report: turn ${match.turn.turnNumber} ${match.turn.phase}`,
    [match.turn.phase, match.turn.turnNumber]
  );
  const [subject, setSubject] = useState(defaultSubject);
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<BoardReportSeverity>("NORMAL");
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submitMessage, setSubmitMessage] = useState("");
  const [submitError, setSubmitError] = useState("");

  function submitReport() {
    if (isSubmitted) return;

    const trimmedSubject = subject.trim();
    const trimmedDescription = description.trim();

    if (!trimmedSubject || !trimmedDescription) {
      setSubmitError("Add a subject and a short description before sending the report.");
      return;
    }

    onQueued?.({
      matchId: match.matchId,
      turnNumber: match.turn.turnNumber,
      phase: match.turn.phase,
      activePlayerId: match.turn.activePlayerId,
      subject: trimmedSubject,
      description: trimmedDescription,
      severity,
      clientContext: getViewportContext()
    });

    setSubmitError("");
    setSubmitMessage("Report queued locally. It will send when match is saved/closed.");
    setDescription("");
    setIsSubmitted(true);
    onSubmitted?.();
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
          submitReport();
        }}
      >
        <label>
          Subject
          <input value={subject} maxLength={140} onChange={event => setSubject(event.target.value)} />
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
          <textarea value={description} maxLength={2400} rows={7} onChange={event => setDescription(event.target.value)} />
        </label>

        {submitError ? <p className="error-box">{submitError}</p> : null}
        {submitMessage ? <p className="success-box">{submitMessage}</p> : null}

        <div className="board-report-actions">
          <button type="submit" disabled={isSubmitted}>{isSubmitted ? "Queued" : "Queue Report"}</button>
        </div>
      </form>
    </section>
  );
}
