import { Renderer, type ActionEvent, type OpenUIError } from "@openuidev/react-lang";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { Outcome, ResponseContent, TurnError } from "../shared/contract";
import {
  composeUserText,
  historyTextFor,
  isOpenUI,
  mainTurns,
  matchKey,
  type Dataset,
  type Scenario,
} from "../shared/dataset";
import { buildRequest, imageAttachment, newSessionId, type HistoryEntry } from "./buildRequest";
import { agriLibrary } from "./library";
import { sendTurn, type SseFrame } from "./sendTurn";

interface Exchange {
  id: number;
  requestHeaders: Record<string, string>;
  requestBody: string;
  status?: number;
  responseHeaders?: Record<string, string>;
  rawBody?: string;
  frames: SseFrame[];
  openui: string[];
}

type ChatMsg =
  | { kind: "user"; id: number; text: string; imageSrc?: string }
  | {
      kind: "assistant";
      id: number;
      exchangeId: number;
      items: ResponseContent[];
      partial: string;
      streaming: boolean;
      outcome?: Outcome;
      error?: TurnError;
      httpError?: string;
    };

interface Session {
  scenario?: Scenario;
  sessionId: string;
  history: HistoryEntry[];
  nextTurn: number;
}

let nextId = 1;

function asText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(", ");
  // Checkbox and switch groups hold { name: true | false }: send the names that are on.
  if (typeof v === "object") {
    return Object.entries(v as Record<string, unknown>)
      .filter(([, on]) => on === true)
      .map(([k]) => k)
      .join(", ");
  }
  return String(v);
}

/**
 * Answers from an action event. formState holds either { [formName]: { field: { value } } } for plain form
 * fields, or, for fields bound to $variables (nested questions), every variable keyed "$name".
 */
function formValuesFrom(event: ActionEvent): Record<string, string> | undefined {
  const state = (event.formState ?? {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  const form = event.formName ? (state[event.formName] as Record<string, { value?: unknown }> | undefined) : undefined;
  if (form) {
    for (const [k, v] of Object.entries(form)) out[k] = asText(v?.value);
  }
  for (const [k, v] of Object.entries(state)) {
    if (k.startsWith("$")) out[k.slice(1)] = asText(v);
  }
  const clean = Object.fromEntries(Object.entries(out).filter(([, v]) => v !== ""));
  return Object.keys(clean).length > 0 ? clean : undefined;
}

export function App() {
  const [dataset, setDataset] = useState<Dataset>();
  const [loadError, setLoadError] = useState<string>();
  const [session, setSession] = useState<Session>();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [selectedExchange, setSelectedExchange] = useState<number>();
  const [stream, setStream] = useState(true);
  const [gzip, setGzip] = useState(false);
  const [busy, setBusy] = useState(false);
  const [freeText, setFreeText] = useState("");
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/scenarios")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`GET /scenarios: HTTP ${r.status}`))))
      .then(setDataset)
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const startSession = useCallback((scenario?: Scenario): Session => {
    const s: Session = { scenario, sessionId: newSessionId(scenario?.id ?? "free"), history: [], nextTurn: 0 };
    setSession(s);
    sessionRef.current = s;
    setMessages([]);
    setExchanges([]);
    setSelectedExchange(undefined);
    return s;
  }, []);

  const send = useCallback(
    async (text: string, imagePath?: string, sessionOverride?: Session) => {
      if (!dataset) return;
      const s = sessionOverride ?? sessionRef.current ?? startSession(undefined);
      setBusy(true);
      const userId = nextId++;
      const assistantId = nextId++;
      const exchangeId = nextId++;
      try {
        const image = imagePath ? await imageAttachment(imagePath, window.location.origin) : undefined;
        const request = buildRequest({ dataset, scenario: s.scenario, sessionId: s.sessionId, history: s.history, current: { text, image } });
        const requestBody = JSON.stringify(request, null, 2);
        setMessages((m) => [
          ...m,
          { kind: "user", id: userId, text, imageSrc: imagePath },
          { kind: "assistant", id: assistantId, exchangeId, items: [], partial: "", streaming: true },
        ]);
        setExchanges((x) => [...x, { id: exchangeId, requestHeaders: {}, requestBody, frames: [], openui: [] }]);
        setSelectedExchange(exchangeId);

        const patchMsg = (fn: (m: Extract<ChatMsg, { kind: "assistant" }>) => Partial<ChatMsg>) =>
          setMessages((all) => all.map((m) => (m.id === assistantId && m.kind === "assistant" ? ({ ...m, ...fn(m) } as ChatMsg) : m)));
        const patchExchange = (fn: (e: Exchange) => Partial<Exchange>) =>
          setExchanges((all) => all.map((e) => (e.id === exchangeId ? { ...e, ...fn(e) } : e)));

        const result = await sendTurn(request, {
          stream,
          gzip,
          onFrame: (frame) => {
            patchExchange((e) => ({ frames: [...e.frames, frame] }));
            const item = frame.parsed?.message.content?.[0];
            if (frame.event === "claim.delta" && item?.type === "output_text_delta") {
              patchMsg((m) => ({ partial: m.partial + item.text }));
            } else if (frame.event === "claim.completed" && item && item.type !== "output_text_delta") {
              patchMsg((m) => ({ items: [...m.items, item], partial: "" }));
            }
          },
        });

        const final = result.response?.message;
        patchExchange(() => ({
          requestHeaders: result.requestHeaders,
          status: result.status,
          responseHeaders: result.headers,
          rawBody: result.rawBody,
          openui: (final?.content ?? []).filter((c) => c.type === "text" && isOpenUI(c.text)).map((c) => c.text),
        }));
        if (result.status !== 200 || !final) {
          patchMsg(() => ({ streaming: false, httpError: `HTTP ${result.status}\n${result.rawBody ?? ""}` }));
          return;
        }
        patchMsg(() => ({ streaming: false, partial: "", items: final.content, outcome: final.outcome, error: final.error }));

        const next: Session = {
          ...s,
          history: [
            ...s.history,
            { role: "user", text, image },
            { role: "assistant", text: historyTextFor(dataset, text) },
          ],
          nextTurn: s.scenario && mainTurns(s.scenario)[s.nextTurn]?.user.text === matchKey(text) ? s.nextTurn + 1 : s.nextTurn,
        };
        setSession(next);
        sessionRef.current = next;
      } catch (e) {
        setMessages((all) =>
          all.some((m) => m.id === assistantId)
            ? all.map((m) => (m.id === assistantId ? { ...m, streaming: false, httpError: String(e) } : m))
            : [...all, { kind: "assistant", id: assistantId, exchangeId, items: [], partial: "", streaming: false, httpError: String(e) }],
        );
      } finally {
        setBusy(false);
      }
    },
    [dataset, gzip, startSession, stream],
  );

  const playNext = (scenario: Scenario) => {
    const s = session?.scenario?.id === scenario.id ? session : startSession(scenario);
    const turn = mainTurns(scenario)[s.nextTurn];
    if (!turn) return;
    void send(composeUserText(turn.user.text, turn.user.formValues), turn.user.image, s);
  };

  const onAction = useCallback(
    (event: ActionEvent) => {
      if (busy) return;
      if (event.type === "continue_conversation") {
        void send(composeUserText(event.humanFriendlyMessage, formValuesFrom(event)));
      } else if (event.type === "open_url" && typeof event.params.url === "string") {
        window.open(event.params.url, "_blank", "noopener");
      }
    },
    [busy, send],
  );

  const exchange = exchanges.find((e) => e.id === selectedExchange) ?? exchanges.at(-1);

  return (
    <div className="app">
      <aside className="pane pane-left">
        <h1>DSS × OpenUI harness</h1>
        <p className="ou-muted small">Mock DSS, no LLM. Sends POST /v1/turns per the v1 contract.</p>
        {loadError ? <div className="ou-callout ou-callout--danger">{loadError}</div> : null}
        <ul className="scenarios">
          {dataset?.scenarios.map((sc, idx) => {
            const active = session?.scenario?.id === sc.id;
            const done = active ? session.nextTurn : 0;
            return (
              <Fragment key={sc.id}>
              {sc.group && sc.group !== dataset.scenarios[idx - 1]?.group ? <li className="scenario-group">{sc.group}</li> : null}
              <li className={active ? "scenario active" : "scenario"}>
                <button type="button" className="scenario-title" onClick={() => startSession(sc)} disabled={busy}>
                  <span className="sid">{sc.id}</span> {sc.title}
                </button>
                <div className="chips">
                  <span className="chip chip-kind">{sc.kind}</span>
                  {sc.uiPatterns.map((p) => (
                    <span key={p} className="chip">
                      {p}
                    </span>
                  ))}
                </div>
                <button
                  type="button"
                  className="ou-button ou-button--secondary small-btn"
                  disabled={busy || !dataset || done >= mainTurns(sc).length}
                  onClick={() => playNext(sc)}
                >
                  {done >= mainTurns(sc).length
                    ? `All ${mainTurns(sc).length} scripted turns played`
                    : `Play next scripted turn (${done + 1}/${mainTurns(sc).length})`}
                </button>
              </li>
              </Fragment>
            );
          })}
        </ul>
        <form
          className="free-text"
          onSubmit={(e) => {
            e.preventDefault();
            if (!freeText.trim()) return;
            void send(freeText);
            setFreeText("");
          }}
        >
          <label className="ou-label" htmlFor="free">
            Free text (unmatched text returns the fallback)
          </label>
          <textarea id="free" className="ou-input" rows={3} value={freeText} onChange={(e) => setFreeText(e.target.value)} />
          <button type="submit" className="ou-button ou-button--primary" disabled={busy || !dataset}>
            Send
          </button>
        </form>
      </aside>

      <main className="pane pane-center">
        <header className="chat-head">
          <div>
            <strong>{session?.scenario ? `${session.scenario.id}: ${session.scenario.title}` : "Free session"}</strong>
            <div className="small ou-muted">{session ? `sessionId ${session.sessionId}` : "Pick a scenario or type a message"}</div>
          </div>
          <div className="toggles">
            <label>
              <input type="checkbox" checked={stream} onChange={(e) => setStream(e.target.checked)} /> Stream (SSE) / JSON:{" "}
              <strong>{stream ? "SSE" : "JSON"}</strong>
            </label>
            <label>
              <input type="checkbox" checked={gzip} onChange={(e) => setGzip(e.target.checked)} /> gzip
            </label>
          </div>
        </header>
        <div className="chat">
          {messages.map((m) =>
            m.kind === "user" ? (
              <div key={m.id} className="bubble user">
                {m.imageSrc ? <img className="thumb" src={m.imageSrc} alt="attached" /> : null}
                <div className="pre">{m.text}</div>
              </div>
            ) : (
              <AssistantBubble
                key={m.id}
                msg={m}
                selected={exchange?.id === m.exchangeId}
                onSelect={() => setSelectedExchange(m.exchangeId)}
                onAction={onAction}
              />
            ),
          )}
          <div ref={chatEnd} />
        </div>
      </main>

      <Inspector exchange={exchange} />
    </div>
  );
}

function AssistantBubble({
  msg,
  selected,
  onSelect,
  onAction,
}: {
  msg: Extract<ChatMsg, { kind: "assistant" }>;
  selected: boolean;
  onSelect: () => void;
  onAction: (e: ActionEvent) => void;
}) {
  return (
    <div className={selected ? "bubble assistant selected" : "bubble assistant"} onClickCapture={onSelect}>
      {msg.outcome ? (
        <div className="outcome">
          <span className={`chip status-${msg.outcome.status}`}>{msg.outcome.status}</span>
          <span className="chip">cause: {msg.outcome.cause ?? "null"}</span>
          <span className="chip">confidence {msg.outcome.confidence}</span>
          {msg.error?.retryAfterSeconds !== undefined ? (
            <span className="chip chip-warn">retry in {msg.error.retryAfterSeconds}s</span>
          ) : null}
        </div>
      ) : null}
      {msg.items.map((item, i) => (
        <ContentItem key={i} item={item} streaming={false} onAction={onAction} />
      ))}
      {msg.streaming && msg.partial ? (
        <ContentItem item={{ type: "text", text: msg.partial }} streaming onAction={onAction} />
      ) : null}
      {msg.streaming && !msg.partial && msg.items.length === 0 ? <div className="ou-muted">…</div> : null}
      {msg.httpError ? <pre className="ou-callout ou-callout--danger pre">{msg.httpError}</pre> : null}
    </div>
  );
}

function ContentItem({
  item,
  streaming,
  onAction,
}: {
  item: ResponseContent;
  streaming: boolean;
  onAction: (e: ActionEvent) => void;
}) {
  const [errors, setErrors] = useState<OpenUIError[]>([]);
  if (item.type === "refusal") return <div className="refusal">{item.text}</div>;
  if (!isOpenUI(item.text)) return <div className="pre">{item.text}</div>;
  return (
    <div className="openui">
      <Renderer library={agriLibrary} response={item.text} isStreaming={streaming} onAction={onAction} onError={setErrors} />
      {errors.length > 0 ? (
        <details className="render-errors">
          <summary>{errors.length} OpenUI error(s)</summary>
          <pre>{JSON.stringify(errors, null, 2)}</pre>
        </details>
      ) : null}
    </div>
  );
}

function pretty(raw?: string): string {
  if (!raw) return "";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="ou-button ou-button--secondary small-btn"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function Inspector({ exchange }: { exchange?: Exchange }) {
  const [tab, setTab] = useState<"request" | "response" | "openui">("request");
  const headers = (h?: Record<string, string>) =>
    Object.entries(h ?? {})
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");

  let body = "";
  let copyText = "";
  if (exchange && tab === "request") {
    body = `POST /v1/turns\n${headers(exchange.requestHeaders)}\n\n${exchange.requestBody}`;
    copyText = exchange.requestBody;
  } else if (exchange && tab === "response") {
    if (exchange.frames.length > 0) {
      copyText = exchange.frames.map((f) => `event: ${f.event}\ndata: ${f.data}\n`).join("\n");
    } else {
      copyText = exchange.rawBody ?? "";
    }
  } else if (exchange && tab === "openui") {
    body = exchange.openui.join("\n\n# ---- next content item ----\n\n") || "(no OpenUI content in this response)";
    copyText = exchange.openui.join("\n\n");
  }

  return (
    <aside className="pane pane-right">
      <div className="tabs" role="tablist">
        {(
          [
            ["request", "Request"],
            ["response", "Response / SSE events"],
            ["openui", "OpenUI source"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "tab active" : "tab"} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
        <span className="spacer" />
        {exchange ? <CopyButton text={copyText} /> : null}
      </div>
      {!exchange ? (
        <p className="ou-muted">No request sent yet.</p>
      ) : tab === "response" ? (
        <div className="wire">
          <pre className="wire-head">{`HTTP ${exchange.status ?? "…"}\n${headers(exchange.responseHeaders)}`}</pre>
          {exchange.frames.length > 0 ? (
            exchange.frames.map((f, i) => (
              <div key={i} className={`frame frame-${f.event.replace(".", "-")}`}>
                <div className="frame-head">
                  <span className="chip">{f.event}</span>
                  <span className="small">sequenceNumber {f.parsed?.context.sequenceNumber ?? "?"}</span>
                </div>
                <pre>{pretty(f.data)}</pre>
              </div>
            ))
          ) : (
            <pre>{pretty(exchange.rawBody)}</pre>
          )}
          <p className="small ou-muted">Shown pretty-printed; Copy copies the exact bytes received.</p>
        </div>
      ) : (
        <pre className="wire">{body}</pre>
      )}
    </aside>
  );
}
