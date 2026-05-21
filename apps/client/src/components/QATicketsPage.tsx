import { type FormEvent, useEffect, useMemo, useState } from "react";

import type { AppMatchState, CardLibraryCardSummary } from "../clientTypes";

export type QATicketStatus = "OPEN" | "IN_PROGRESS" | "READY_FOR_RETEST" | "VERIFIED" | "REOPENED";

export type QATicketRecord = {
  id: string;
  title: string;
  details: string;
  severity: "LOW" | "NORMAL" | "HIGH" | "BLOCKING";
  intent?: "BUG" | "SUGGESTION";
  status: QATicketStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  matchId?: string;
  turnLabel?: string;
  resolutionNotes?: string;
  relatedCardId?: string;
  relatedCardName?: string;
  relatedMatchIds?: string[];
  addendums?: Array<{
    id: string;
    createdAt: string;
    createdBy: string;
    details: string;
    matchId?: string;
    turnLabel?: string;
  }>;
};

type QATicketFilter = "ALL" | "OPEN_ONLY" | "READY_FOR_RETEST" | "SUGGESTIONS";
type QATicketSort = "UPDATED_DESC" | "SEVERITY_DESC" | "STATUS";

type QATicketsPageProps = {
  tickets: QATicketRecord[];
  authDisplayName: string;
  liveMatch: AppMatchState | null;
  cardLibrary: CardLibraryCardSummary[];
  preferredPlayerId?: string | null;
  onCreateTicket: (ticket: Omit<QATicketRecord, "id" | "createdAt" | "updatedAt">) => void;
  onUpdateTicket: (ticketId: string, changes: Partial<QATicketRecord>) => void;
  onDownloadTicketJson?: (ticket: QATicketRecord) => void;
  onDownloadAllTicketsJson?: () => void;
  initialAddendumTicketId?: string | null;
  canMarkReadyForRetest?: boolean;
};

export function QATicketsPage({
  tickets,
  authDisplayName,
  liveMatch,
  cardLibrary,
  preferredPlayerId = null,
  onCreateTicket,
  onUpdateTicket,
  onDownloadTicketJson,
  onDownloadAllTicketsJson,
  initialAddendumTicketId = null,
  canMarkReadyForRetest = false
}: QATicketsPageProps) {
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [severity, setSeverity] = useState<QATicketRecord["severity"]>("NORMAL");
  const [intent, setIntent] = useState<"BUG" | "SUGGESTION">("BUG");
  const [filterMode, setFilterMode] = useState<QATicketFilter>("ALL");
  const [sortMode, setSortMode] = useState<QATicketSort>("UPDATED_DESC");
  const [matchFilter, setMatchFilter] = useState("");
  const [includeLiveMatchContext, setIncludeLiveMatchContext] = useState(true);
  const [relatedCardId, setRelatedCardId] = useState("");
  const [addendumTargetTicketId, setAddendumTargetTicketId] = useState(initialAddendumTicketId ?? "");
  const cardLookupById = useMemo(() => new Map(cardLibrary.map(card => [card.id, card])), [cardLibrary]);
  const searchableCards = useMemo(() => {
    if (!liveMatch) {
      return [...cardLibrary].sort((a, b) => a.name.localeCompare(b.name));
    }

    const cardIds = new Set<string>();
    const collectCardId = (card?: { cardId?: string }) => {
      if (card?.cardId) cardIds.add(card.cardId);
    };
    liveMatch.players.forEach(player => {
      player.deck.forEach(collectCardId);
      player.hand.forEach(collectCardId);
      player.cemetery.forEach(collectCardId);
      player.removedFromGame.forEach(collectCardId);
      collectCardId(player.field.primaryCreature);
      player.field.limitedSummons.forEach(collectCardId);
      player.field.magicSlots.forEach(collectCardId);
    });
    return cardLibrary
      .filter(card => cardIds.has(card.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [cardLibrary, liveMatch, preferredPlayerId]);

  const sortedTickets = useMemo(
    () => [...tickets].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    [tickets]
  );
  const duplicateCandidates = useMemo(
    () => relatedCardId
      ? sortedTickets.filter(ticket =>
        ticket.relatedCardId === relatedCardId &&
        ticket.status !== "VERIFIED" &&
        title.trim().length > 0 &&
        ticket.title.toLowerCase().includes(title.trim().toLowerCase())
      )
      : [],
    [relatedCardId, sortedTickets, title]
  );
  const openTicketsForSelectedCard = useMemo(
    () => relatedCardId
      ? sortedTickets.filter(ticket => ticket.relatedCardId === relatedCardId && ticket.status !== "VERIFIED")
      : [],
    [relatedCardId, sortedTickets]
  );
  const suggestionBacklogTickets = useMemo(
    () => sortedTickets.filter(ticket => (ticket.intent ?? "BUG") === "SUGGESTION" && ticket.status !== "VERIFIED"),
    [sortedTickets]
  );
  const visibleTickets = useMemo(() => {
    const base = sortedTickets.filter(ticket => {
      if (filterMode === "OPEN_ONLY") return ticket.status !== "VERIFIED";
      if (filterMode === "READY_FOR_RETEST") return ticket.status === "READY_FOR_RETEST";
      if (filterMode === "SUGGESTIONS") return (ticket.intent ?? "BUG") === "SUGGESTION";
      return true;
    }).filter(ticket => {
      if (!matchFilter.trim()) return true;
      const matchIds = new Set([...(ticket.relatedMatchIds ?? []), ...(ticket.matchId ? [ticket.matchId] : [])]);
      return Array.from(matchIds).some(id => id.includes(matchFilter.trim()));
    });
    if (sortMode === "SEVERITY_DESC") {
      const rank: Record<QATicketRecord["severity"], number> = { BLOCKING: 4, HIGH: 3, NORMAL: 2, LOW: 1 };
      return [...base].sort((a, b) => rank[b.severity] - rank[a.severity] || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    }
    if (sortMode === "STATUS") {
      return [...base].sort((a, b) => a.status.localeCompare(b.status) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    }
    return base;
  }, [filterMode, matchFilter, sortMode, sortedTickets]);
  useEffect(() => {
    if (initialAddendumTicketId) {
      setAddendumTargetTicketId(initialAddendumTicketId);
    }
  }, [initialAddendumTicketId]);

  function submitTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    const trimmedDetails = details.trim();
    if (!trimmedTitle || !trimmedDetails) return;

    if (addendumTargetTicketId) {
      const targetTicket = tickets.find(ticket => ticket.id === addendumTargetTicketId);
      if (!targetTicket) return;
      const now = new Date().toISOString();
      const nextAddendums = [...(targetTicket.addendums ?? []), {
        id: `ADD-${Date.now().toString(36).toUpperCase()}`,
        createdAt: now,
        createdBy: authDisplayName,
        details: trimmedDetails,
        matchId: includeLiveMatchContext && liveMatch ? liveMatch.matchId : undefined,
        turnLabel: includeLiveMatchContext && liveMatch ? `Turn ${liveMatch.turn.turnNumber} / ${liveMatch.turn.phase}` : undefined
      }];
      onUpdateTicket(addendumTargetTicketId, {
        updatedAt: now,
        relatedMatchIds: Array.from(new Set([
          ...(targetTicket.relatedMatchIds ?? []),
          ...(targetTicket.matchId ? [targetTicket.matchId] : []),
          ...(liveMatch?.matchId ? [liveMatch.matchId] : [])
        ])),
        addendums: nextAddendums,
        resolutionNotes: [targetTicket.resolutionNotes, `Addendum (${new Date(now).toLocaleString()}): ${trimmedDetails}`]
          .filter(Boolean)
          .join("\n")
      });
      setDetails("");
      setAddendumTargetTicketId("");
      return;
    }

    onCreateTicket({
      title: trimmedTitle,
      details: trimmedDetails,
      severity,
      intent,
      status: "OPEN",
      createdBy: authDisplayName,
      matchId: includeLiveMatchContext && liveMatch ? liveMatch.matchId : undefined,
      turnLabel: includeLiveMatchContext && liveMatch ? `Turn ${liveMatch.turn.turnNumber} / ${liveMatch.turn.phase}` : undefined,
      resolutionNotes: "",
      relatedCardId: relatedCardId || undefined,
      relatedCardName: relatedCardId ? cardLookupById.get(relatedCardId)?.name : undefined,
      relatedMatchIds: includeLiveMatchContext && liveMatch ? [liveMatch.matchId] : []
    });

    setTitle("");
    setDetails("");
    setSeverity("NORMAL");
    setIntent("BUG");
    setRelatedCardId("");
  }

  return (
    <section className="qa-ticket-page">
      <section className="card qa-ticket-compose-card">
        <h2>Report Intake</h2>
        <p className="subtitle">Use this local report board to track, retest, verify, and reopen fixes.</p>
        {onDownloadAllTicketsJson ? (
          <div className="board-report-actions">
            <button type="button" onClick={onDownloadAllTicketsJson}>Download All Reports JSON</button>
          </div>
        ) : null}
        <div className="qa-ticket-toolbar">
          <label>Filter
            <select value={filterMode} onChange={event => setFilterMode(event.target.value as QATicketFilter)}>
              <option value="ALL">All</option>
              <option value="OPEN_ONLY">Open only</option>
              <option value="READY_FOR_RETEST">Ready for retest</option>
              <option value="SUGGESTIONS">Suggestions</option>
            </select>
          </label>
          <label>Sort
            <select value={sortMode} onChange={event => setSortMode(event.target.value as QATicketSort)}>
              <option value="UPDATED_DESC">Updated</option>
              <option value="SEVERITY_DESC">Severity</option>
              <option value="STATUS">Status</option>
            </select>
          </label>
          <label>Match
            <input value={matchFilter} onChange={event => setMatchFilter(event.target.value)} placeholder="Filter match id" />
          </label>
        </div>
        <form className="qa-ticket-compose-form" onSubmit={submitTicket}>
          <label>
            Ticket title
            <input value={title} maxLength={140} onChange={event => setTitle(event.target.value)} placeholder="Example: Counter animation desync in attack phase" />
          </label>
          <label>
            Repro steps / details
            <textarea value={details} rows={5} maxLength={2400} onChange={event => setDetails(event.target.value)} placeholder="What happened, expected result, and how to reproduce." />
          </label>
          <label>
            Related card from either active match deck (optional)
            <select
              value={relatedCardId}
              onChange={event => {
                setRelatedCardId(event.target.value);
                setAddendumTargetTicketId("");
              }}
            >
              <option value="">None</option>
              {searchableCards.map(card => (
                <option key={card.id} value={card.id}>
                  {card.name} ({card.id})
                </option>
              ))}
            </select>
          </label>
          {relatedCardId && openTicketsForSelectedCard.length > 0 ? (
            <label>
              Existing open report for this card
              <select value={addendumTargetTicketId} onChange={event => setAddendumTargetTicketId(event.target.value)}>
                <option value="">Create new primary report</option>
                {openTicketsForSelectedCard.map(ticket => (
                  <option key={ticket.id} value={ticket.id}>
                    Add to #{ticket.id} — {ticket.title}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {duplicateCandidates.length > 0 ? (
            <div className="warning-box">
              Existing report found for this card — add addendum instead of creating duplicate. Matching reports: {duplicateCandidates.slice(0, 2).map(ticket => `#${ticket.id}`).join(", ")}.
            </div>
          ) : null}
          <label>
            Type
            <select value={intent} onChange={event => {
              const next = event.target.value as "BUG" | "SUGGESTION";
              setIntent(next);
              if (next === "SUGGESTION") setSeverity("LOW");
            }}>
              <option value="BUG">Bug</option>
              <option value="SUGGESTION">Suggestion Backlog</option>
            </select>
          </label>
          <label>
            Severity
            <select value={severity} onChange={event => setSeverity(event.target.value as QATicketRecord["severity"])}>
              <option value="LOW">Low</option>
              <option value="NORMAL">Normal</option>
              <option value="HIGH">High</option>
              <option value="BLOCKING">Blocking</option>
            </select>
          </label>
          <label className="qa-ticket-context-toggle">
            <input
              type="checkbox"
              checked={includeLiveMatchContext}
              onChange={event => setIncludeLiveMatchContext(event.target.checked)}
            />
            Include current match context when available
          </label>
          <div className="board-report-actions">
            <button type="submit">{addendumTargetTicketId ? "Add Addendum" : "Create Report"}</button>
          </div>
        </form>
      </section>

      <section className="qa-ticket-list">
        {suggestionBacklogTickets.length > 0 ? (
          <section className="card qa-ticket-suggestion-backlog">
            <h3>Suggestion Backlog</h3>
            <ul>
              {suggestionBacklogTickets.slice(0, 6).map(ticket => (
                <li key={ticket.id}>#{ticket.id} — {ticket.title}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {visibleTickets.length === 0 ? (
          <section className="card qa-ticket-empty">
            <h3>No reports yet</h3>
            <p>Create one above to start tracking report → fix → retest flow.</p>
          </section>
        ) : visibleTickets.map(ticket => (
          <article key={ticket.id} className="card qa-ticket-card">
            <header>
              <div>
                <h3>{ticket.title}</h3>
                <p className="qa-ticket-meta">#{ticket.id} · {ticket.createdBy} · {new Date(ticket.createdAt).toLocaleString()}</p>
              </div>
              <span className={`qa-ticket-status ${ticket.status.toLowerCase()}`}>{ticket.status.replace(/_/g, " ")}</span>
            </header>
            <p>{ticket.details}</p>
            <p className="qa-ticket-meta">
              Severity: {ticket.severity}
              {ticket.relatedCardName ? ` · Card: ${ticket.relatedCardName}` : ""}
              {ticket.relatedCardId ? ` (${ticket.relatedCardId})` : ""}
              {ticket.matchId ? ` · Match: ${ticket.matchId}` : ""}
              {ticket.relatedMatchIds && ticket.relatedMatchIds.length > 1 ? ` · Linked matches: ${ticket.relatedMatchIds.length}` : ""}
              {ticket.turnLabel ? ` · ${ticket.turnLabel}` : ""}
            </p>
            <label>
              Status
              <select
                value={ticket.status}
                onChange={event => onUpdateTicket(ticket.id, { status: event.target.value as QATicketStatus })}
              >
                <option value="OPEN">Open</option>
                <option value="IN_PROGRESS">In Progress</option>
                {canMarkReadyForRetest ? <option value="READY_FOR_RETEST">Ready for Retest</option> : null}
                <option value="VERIFIED">Verified Fixed</option>
                <option value="REOPENED">Reopened</option>
              </select>
            </label>
            <div className="board-report-actions">
              {canMarkReadyForRetest ? (
                <button type="button" onClick={() => onUpdateTicket(ticket.id, { status: "READY_FOR_RETEST" })}>Mark Ready for Retest</button>
              ) : null}
              <button type="button" onClick={() => onUpdateTicket(ticket.id, { status: "VERIFIED" })}>Verify Fix</button>
              <button type="button" onClick={() => onUpdateTicket(ticket.id, { status: "REOPENED" })}>Reopen</button>
            </div>
            <label>
              Resolution / retest notes
              <textarea
                value={ticket.resolutionNotes ?? ""}
                rows={3}
                onChange={event => onUpdateTicket(ticket.id, { resolutionNotes: event.target.value })}
                placeholder="Add fix notes or retest result."
              />
            </label>
            {onDownloadTicketJson ? (
              <div className="board-report-actions">
                <button type="button" onClick={() => onDownloadTicketJson(ticket)}>Download JSON</button>
              </div>
            ) : null}
            {ticket.addendums && ticket.addendums.length > 0 ? (
              <div className="qa-ticket-addendum-history">
                <strong>Addendums</strong>
                <ul>
                  {ticket.addendums.map(addendum => (
                    <li key={addendum.id}>
                      <span>{new Date(addendum.createdAt).toLocaleString()} · {addendum.createdBy}</span>
                      <p>{addendum.details}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </article>
        ))}
      </section>
    </section>
  );
}
