"use client";

import { MessageCircle, Sparkles, X } from "lucide-react";
import { useState } from "react";
import type { PubmatQuickFetchResponse } from "./types";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { formatTime } from "./utils";

interface PubmatChatResponse {
  answer: string;
  aiProvider: "gemini" | "deterministic";
  aiWarning?: string;
  aiFinishReason?: string;
  fallbackReason?: string;
  aiError?: string;
}

export function PubmatChatPanel({ data }: { data: PubmatQuickFetchResponse | null }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("Summarize this pubmat table for publication.");
  const [answer, setAnswer] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [finishReason, setFinishReason] = useState<string | null>(null);
  const [provider, setProvider] = useState<"gemini" | "deterministic" | null>(null);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function askPubmatCopilot() {
    if (!data) return;

    setLoading(true);
    setError(null);
    setWarning(null);
    setFinishReason(null);
    setFallbackReason(null);

    try {
      const response = await fetch("/api/pubmat-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, pubmat: data }),
      });

      if (!response.ok) throw new Error(`Pubmat chat failed (${response.status})`);

      const payload = (await response.json()) as PubmatChatResponse;
      setAnswer(payload.answer);
      setProvider(payload.aiProvider);
      setWarning(payload.aiWarning ?? null);
      setFinishReason(payload.aiFinishReason ?? null);
      setFallbackReason(payload.fallbackReason ?? null);
      setError(payload.aiError ?? null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unknown pubmat chat error");
    } finally {
      setLoading(false);
    }
  }

  const disabled = loading || !data;
  const launcherLabel = answer ? "Open pubmat chat response" : "Ask pubmat chat";

  return (
    <div className="fixed right-4 bottom-4 z-40 flex max-w-[calc(100vw-32px)] flex-col items-end gap-3 sm:right-5 sm:bottom-5">
      {open ? (
        <aside
          id="pubmat-chat-panel"
          className="panel max-h-[min(720px,calc(100vh-104px))] w-[min(420px,calc(100vw-32px))] overflow-auto shadow-xl"
          aria-label="Pubmat chat"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-success-foreground" aria-hidden="true" />
                <h2 className="panel-title">Pubmat Chat</h2>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {data ? `${data.results.length} stations loaded` : "Fetch a table first"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {provider ? <span className="status-chip">{provider === "gemini" ? "Gemini" : "Deterministic"}</span> : null}
              <button
                className="icon-button"
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close pubmat chat"
                title="Close pubmat chat"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {data ? (
            <div className="mt-4 grid gap-2 rounded-[6px] border border-border-subtle bg-surface p-3 text-xs text-label">
              <p>Bucket: {formatTime(data.window.bucketStart)} to {formatTime(data.window.bucketEnd)}</p>
              <p>Metric: {data.selection.metric}</p>
              <p>Source: {data.source === "kloudtrack" ? "KloudTrack API" : "Demo fallback"}</p>
            </div>
          ) : null}

          <label className="field-label">
            Question
            <textarea
              className="field min-h-[112px] resize-y"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
            />
          </label>

          <button className="primary-action mt-3 w-full" type="button" onClick={() => void askPubmatCopilot()} disabled={disabled}>
            {loading ? "Asking" : "Ask about table"}
          </button>

          {error ? (
            <p className="mt-3 rounded-md border border-danger-border bg-danger-surface p-3 text-sm text-danger-foreground">
              {error}
            </p>
          ) : null}

          {fallbackReason ? (
            <p className="mt-3 rounded-md border border-warning-border bg-warning-surface p-3 text-sm text-warning-foreground">
              Internal formatting fallback: {fallbackReason}
            </p>
          ) : null}

          {warning ? (
            <p className="mt-3 rounded-md border border-warning-border bg-warning-surface p-3 text-sm text-warning-foreground">
              {warning}
            </p>
          ) : null}

          <div className="mt-4 border-t border-border-subtle pt-4 text-sm leading-6 text-card-foreground">
            {answer ? (
              <MarkdownRenderer text={answer} />
            ) : data ? (
              <p className="text-label">Ask a question about the fetched station table.</p>
            ) : (
              <p className="text-label">Fetch the pubmat table, then ask for summary, anomalies, or caption-ready copy.</p>
            )}
          </div>

          {finishReason ? (
            <p className="mt-4 border-t border-border-subtle pt-4 text-xs text-label">
              AI finish reason: {finishReason}
            </p>
          ) : null}
        </aside>
      ) : null}

      <button
        className="chat-launcher"
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-controls="pubmat-chat-panel"
        aria-expanded={open}
        aria-label={launcherLabel}
        title={launcherLabel}
      >
        <MessageCircle className="h-5 w-5" aria-hidden="true" />
        {answer ? (
          <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full border-2 border-card bg-danger" />
        ) : null}
      </button>
    </div>
  );
}
