import { useEffect, useRef, useState } from "react";
import "./App.css";


// With the Vite proxy configured, /api/* is forwarded to localhost:5000.

// Keeping the URL relative means the frontend never needs a hardcoded port.


const API_BASE_URL = (
  import.meta.env.VITE_API_URL || ""
).replace(/\/$/, "");

const CHECKINS_URL = `${API_BASE_URL}/api/checkins`;
const CHAT_URL = `${API_BASE_URL}/api/chat`;
const MCP_TOOL_URL = `${API_BASE_URL}/api/mcp/tool`;

// Helpers

/** Format "20:00" -> "8:00 PM" for display inside chat result cards. */

function fmt24(hhmm) {
  if (!hhmm || !hhmm.includes(":")) return hhmm;
  const [hStr, mStr] = hhmm.split(":");
  const h    = parseInt(hStr, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  const dh   = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return dh + ":" + mStr + " " + ampm;
}


// ChatPanel


/**
 * Self-contained conversational panel.
 * Props:
 *   onCheckInsChanged() -- called after an action mutates check-in data
 *                          so the dashboard stats stay in sync.
 */

function ChatPanel({ onCheckInsChanged }) {
  const [messages, setMessages]   = useState([
    {
      id:   "welcome",
      role: "assistant",
      text: "Hi! I'm CareCue. I can list, create, and complete check-ins for your family. Try asking me to \"show check-ins\" or \"add a check-in for Dad at 8 pm\".",
      mode: "fallback",
      results: [],
    },
  ]);
  const [input, setInput]         = useState("");
  const [sending, setSending]     = useState(false);
  const [error, setError]         = useState("");
  const bottomRef                 = useRef(null);
  const inputRef                  = useRef(null);

  // Scroll to the latest message whenever messages change.

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function appendMessage(msg) {
    setMessages((prev) => [...prev, { id: Date.now() + Math.random(), ...msg }]);
  }


async function send() {
    const text = input.trim();
    if (!text || sending) return;

    setInput("");
    setError("");
    appendMessage({ role: "user", text });
    setSending(true);

    try {
      const lower = text.toLowerCase();
      let toolName = null;
      let toolArguments = {};

      // Detect the requested action using simple keyword rules.

      const listRequest =
        /\b(show|list|view|display)\b/.test(lower) &&
        /\b(check-?ins?|schedule|family)\b/.test(lower);

      const completeRequest =
        /\b(complete|finish|mark)\b/.test(lower) &&
        /\b(check-?in|done|completed)\b/.test(lower);

      const createRequest =
        /\b(add|create|schedule)\b/.test(lower) &&
        /\bcheck-?in\b/.test(lower);

      if (listRequest) {
        toolName = "list_checkins";
      } else if (createRequest) {

        // A create command needs both a family member and a time.

        const personMatch = text.match(
          /\bfor\s+(Dad|Mom|Father|Mother|Grandma|Grandpa)\b/i
        );
        const timeMatch = text.match(
          /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i
        );

        if (!personMatch || !timeMatch) {
          throw new Error(
            "Please include a family member and time, e.g. “Add a check-in for Dad at 8 pm.”"
          );
        }

        let hour = Number(timeMatch[1]);
        const minute = Number(timeMatch[2] || "00");
        const period = timeMatch[3].toLowerCase();

        if (hour < 1 || hour > 12 || minute > 59) {
          throw new Error("Please enter a valid time, such as 8 pm.");
        }

        if (period === "pm" && hour !== 12) hour += 12;
        if (period === "am" && hour === 12) hour = 0;

        const person = personMatch[1];
        toolName = "create_checkin";
        toolArguments = {
          name: `${person}'s check-in`,
          person,
          time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
        };
      } else if (completeRequest) {

        // MCP expects the numeric ID of the check-in to complete.

        const idMatch = text.match(
          /\b(?:complete|finish|mark)\s+(?:check-?in\s*)?#?(\d+)\b/i
        );

        if (!idMatch) {
          throw new Error(
            "Please include the numeric check-in ID, e.g. “Complete check-in 123.”"
          );
        }

        const id = Number(idMatch[1]);
        if (!Number.isSafeInteger(id) || id <= 0) {
          throw new Error("That check-in ID is invalid.");
        }

        toolName = "complete_checkin";
        toolArguments = { id };
      }

      if (toolName) {

        // Send the action to the remote MCP tools through the backend.

        const response = await fetch(MCP_TOOL_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: toolName,
            arguments: toolArguments,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          console.error("MCP request failed:", response.status, data);
          throw new Error(
            data.message ||
            data.error ||
            `MCP request failed with HTTP ${response.status}.`
          );
        }

        if (data.isError || data.result?.isError) {
          const errorText = data.result?.content
            ?.find((item) => item.type === "text")?.text;
          throw new Error(errorText || "The MCP tool could not complete the request.");
        }

        const contentText = data.result?.content?.find(
          (item) => item.type === "text"
        )?.text;

        if (!contentText) {
          throw new Error("The MCP server returned an empty result.");
        }

        let parsed;
        try {
          parsed = JSON.parse(contentText);
        } catch {
          parsed = contentText;
        }

        if (toolName === "list_checkins") {
          const checkIns = Array.isArray(parsed)
            ? parsed
            : Array.isArray(parsed.checkIns)
              ? parsed.checkIns
              : [];

          appendMessage({
            role: "assistant",
            text: `Retrieved ${checkIns.length} check-in(s) using the remote CareCue MCP server.`,
            mode: "mcp",
            results: [{ action: "list_checkins", checkIns }],
          });
        } else if (toolName === "create_checkin") {
          appendMessage({
            role: "assistant",
            text: `Created "${parsed.name}" for ${parsed.person} at ${fmt24(parsed.time)}.`,
            mode: "mcp",
            results: [{ action: "create_checkin", checkIn: parsed }],
          });
          onCheckInsChanged();
        } else if (toolName === "complete_checkin") {
          appendMessage({
            role: "assistant",
            text: `MCP result: ${parsed.name || "Check-in"} marked complete.`,
            mode: "mcp",
            results: [{ action: "complete_checkin", checkIn: parsed }],
          });
          onCheckInsChanged();
        }
      } else {

        // Preserve the existing rule-based chat for other questions.

        const response = await fetch(CHAT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.message || "The assistant could not process your request."
          );
        }

        appendMessage({
          role: "assistant",
          text: data.reply,
          mode: data.mode,
          results: data.results ?? [],
        });

        const mutating = ["create_checkin", "complete_checkin"];
        const didMutate = (data.results ?? []).some(
          (result) => mutating.includes(result.action) && !result.error
        );

        if (didMutate) onCheckInsChanged();
      }
    } catch (err) {
      setError(err.message || "Could not reach the CareCue backend.");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }


  function handleKeyDown(e) {
    // Enter sends; Shift+Enter inserts a newline.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="chat-shell">
      {/* ── Message list ── */}
      <div className="chat-messages" role="log" aria-live="polite" aria-label="Conversation">
        {messages.map((msg) => (
          <div key={msg.id} className={"chat-row chat-row--" + msg.role}>
            {msg.role === "assistant" && (
              <div className="chat-avatar" aria-hidden="true">CC</div>
            )}

            <div className="chat-bubble-wrap">
              <div className={"chat-bubble chat-bubble--" + msg.role}>
                {/* Preserve newlines in the reply text */}
                {msg.text.split("\n").map((line, i) => (
                  <span key={i}>{line}{i < msg.text.split("\n").length - 1 && <br />}</span>
                ))}
              </div>

              {/* Action result cards */}
              {msg.results && msg.results.length > 0 && (
                <div className="chat-results">
                  {msg.results.map((r, i) => (
                    <ActionResult key={i} result={r} />
                  ))}
                </div>
              )}

              {/* Mode badge — only on assistant messages */}
              {msg.role === "assistant" && msg.mode === "fallback" && (
                <span className="chat-mode-badge" title="Amazon Bedrock is not currently enabled. Using the built-in rule-based engine.">
                  Rule-based mode
                </span>
              )}
            </div>

            {msg.role === "user" && (
              <div className="chat-avatar chat-avatar--user" aria-hidden="true">You</div>
            )}
          </div>
        ))}

        {/* Typing indicator */}
        {sending && (
          <div className="chat-row chat-row--assistant">
            <div className="chat-avatar" aria-hidden="true">CC</div>
            <div className="chat-bubble chat-bubble--assistant chat-bubble--typing" aria-label="CareCue is thinking">
              <span /><span /><span />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="chat-error" role="alert">
          {error}
          <button onClick={() => setError("")} aria-label="Dismiss error">x</button>
        </div>
      )}

      {/* ── Input row ── */}
      <div className="chat-input-row">
        <textarea
          ref={inputRef}
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask CareCue something... (Enter to send)"
          rows={1}
          disabled={sending}
          aria-label="Chat message"
        />
        <button
          className="chat-send-button"
          onClick={send}
          disabled={sending || !input.trim()}
          aria-label="Send message"
        >
          {sending ? "..." : "Send"}
        </button>
      </div>

      <p className="chat-hint">Enter to send&nbsp;&nbsp;·&nbsp;&nbsp;Shift+Enter for a new line</p>
    </div>
  );
}


// ActionResult — renders one entry from the results[] array


function ActionResult({ result }) {
  if (result.error) {
    return (
      <div className="action-card action-card--error">
        <span className="action-card__icon">!</span>
        <span>{result.error}</span>
      </div>
    );
  }

  if (result.action === "list_checkins") {
    const items = result.checkIns ?? [];
    return (
      <div className="action-card action-card--list">
        <p className="action-card__label">
          {items.length === 0 ? "No check-ins found." : items.length + " check-in" + (items.length !== 1 ? "s" : "")}
        </p>
        {items.map((c) => (
          <div key={c.id} className="action-mini-item">
            <span className={"action-mini-dot action-mini-dot--" + c.status.toLowerCase()} />
            <span className="action-mini-name">{c.name}</span>
            <span className="action-mini-meta">ID: {c.id}</span>
            <span className="action-mini-meta">
              {c.person} &middot; {String(c.time).match(/\b(AM|PM)\b/i) ? c.time : fmt24(c.time)}
            </span>
            <span className={"status " + c.status.toLowerCase()}>{c.status}</span>
          </div>
        ))}
      </div>
    );
  }

  if (result.action === "create_checkin" && result.checkIn) {
    const c = result.checkIn;
    return (
      <div className="action-card action-card--created">
        <span className="action-card__icon">+</span>
        <div className="action-card__body">
          <strong>{c.name}</strong>
          <span>{c.person} &middot; {fmt24(c.time)}</span>
          <span className={"status " + c.status.toLowerCase()}>{c.status}</span>
        </div>
      </div>
    );
  }

  if (result.action === "complete_checkin" && result.checkIn) {
    const c = result.checkIn;
    return (
      <div className="action-card action-card--completed">
        <span className="action-card__icon">&#10003;</span>
        <div className="action-card__body">
          <strong>{c.name}</strong>
          <span>{c.person} &middot; {fmt24(c.time)}</span>
          <span className="status completed">Completed</span>
        </div>
      </div>
    );
  }

  return null;
}


// App

function App() {
  const [checkIns, setCheckIns] = useState([]);
  const [name, setName]         = useState("");
  const [person, setPerson]     = useState("Dad");
  const [time, setTime]         = useState("19:00");
  const [notice, setNotice]     = useState("");
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);

  // "dashboard" | "chat"
  const [activeTab, setActiveTab] = useState("dashboard");

  const completed = checkIns.filter((item) => item.status === "Completed").length;
  const pending   = checkIns.length - completed;

  async function loadCheckIns() {
    try {
      const response = await fetch(CHECKINS_URL);
      if (!response.ok) throw new Error("Unable to load check-ins.");
      const data = await response.json();
      setCheckIns(data);
      setNotice("");
    } catch {
      setNotice("Cannot connect to CareCue backend. Make sure it is running on port 5000.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCheckIns();
  }, []);

  async function addCheckIn(event) {
    event.preventDefault();
    if (!name.trim()) { setNotice("Please enter a check-in name."); return; }
    setSaving(true);
    try {
      const response = await fetch(CHECKINS_URL, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ name: name.trim(), person, time }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Failed to create check-in.");
      setCheckIns((current) => [...current, data.checkIn]);
      setName("");
      setNotice("Check-in created successfully.");
    } catch (error) {
      setNotice(error.message || "Could not create check-in.");
    } finally {
      setSaving(false);
    }
  }

  async function completeCheckIn(id) {
    try {
      const response = await fetch(`${CHECKINS_URL}/${id}/complete`, { method: "PATCH" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Failed to complete check-in.");
      setCheckIns((current) => current.map((item) => item.id === id ? data.checkIn : item));
      setNotice("Check-in marked as completed.");
    } catch (error) {
      setNotice(error.message || "Could not complete check-in.");
    }
  }

  // Called by ChatPanel after a mutation so the dashboard stats refresh.
  function handleCheckInsChanged() {
    loadCheckIns();
  }

  // ── Sidebar nav helper ──
  function NavLink({ tab, href, children }) {
    const isActive = tab ? activeTab === tab : false;
    return (
      <a
        className={"nav-link" + (isActive ? " active" : "")}
        href={href ?? "#"}
        onClick={tab ? (e) => { e.preventDefault(); setActiveTab(tab); } : undefined}
      >
        {children}
      </a>
    );
  }

  return (
    <div className="app-shell">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(e) => { e.preventDefault(); setActiveTab("dashboard"); }}>
          <span className="brand-icon">&#10035;</span>
          <span>CareCue</span>
        </a>

        <p className="nav-heading">WORKSPACE</p>
        <NavLink tab="dashboard" href="#dashboard">&#9638; Dashboard</NavLink>
        <NavLink tab="chat"      href="#chat">&#9997; Ask CareCue</NavLink>
        <a className="nav-link" href="#checkins"
          onClick={(e) => { e.preventDefault(); setActiveTab("dashboard"); }}>
          &#9711; Check-ins
        </a>
        <a className="nav-link" href="#activity"
          onClick={(e) => { e.preventDefault(); setActiveTab("dashboard"); }}>
          &#8599; Activity
        </a>

        <div className="sidebar-bottom">
          <div className="avatar">CC</div>
          <div>
            <strong>Family Care</strong>
            <p>Care coordinator</p>
          </div>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="main-content">
        <header className="topbar">
          <span>
            Family workspace&nbsp;/&nbsp;
            {activeTab === "chat" ? "Ask CareCue" : "Dashboard"}
          </span>
          <span className="live-label">
            <span />
            Backend connected
          </span>
        </header>

        {/* ════════════════ DASHBOARD TAB ════════════════ */}
        {activeTab === "dashboard" && (
          <>
            <section className="welcome">
              <p className="eyebrow">YOUR FAMILY, BETTER CONNECTED</p>
              <h1>A little care goes a long way.</h1>
              <p>Keep check-ins organized and stay on top of everyday care.</p>
            </section>

            <section className="stats-grid">
              <article className="stat-card">
                <span className="stat-label">Total check-ins</span>
                <strong>{checkIns.length}</strong>
                <span className="stat-foot">Loaded from the backend</span>
              </article>
              <article className="stat-card">
                <span className="stat-label">Completed</span>
                <strong>{completed}</strong>
                <span className="stat-foot">Recorded as completed</span>
              </article>
              <article className="stat-card">
                <span className="stat-label">Awaiting check-in</span>
                <strong>{pending}</strong>
                <span className="stat-foot">Not yet marked complete</span>
              </article>
            </section>

            {notice && (
              <div className="notice" role="status">
                {notice}
                <button onClick={() => setNotice("")} aria-label="Dismiss">&#215;</button>
              </div>
            )}

            <div id="dashboard" className="content-grid">
              {/* Check-in list */}
              <section className="panel" id="checkins">
                <div className="panel-header">
                  <div>
                    <h2>Today's check-ins</h2>
                    <p>Track your family's scheduled check-ins.</p>
                  </div>
                  <span className="count-badge">{checkIns.length}</span>
                </div>

                <div className="checkin-list">
                  {loading ? (
                    <p style={{ padding: "20px" }}>Loading check-ins...</p>
                  ) : checkIns.length === 0 ? (
                    <p style={{ padding: "20px" }}>No check-ins yet. Create one to get started.</p>
                  ) : (
                    checkIns.map((item) => (
                      <article className="checkin-item" key={item.id}>
                        <div className="check-icon">
                          {item.status === "Completed" ? "\u2713" : "\u25F7"}
                        </div>
                        <div className="check-details">
                          <strong>{item.name}</strong>
                          <p>{item.person} &middot; {item.time}</p>
                        </div>
                        <div className="check-actions">
                          <span className={"status " + item.status.toLowerCase()}>
                            {item.status}
                          </span>
                          {item.status !== "Completed" && (
                            <button
                              className="complete-button"
                              onClick={() => completeCheckIn(item.id)}
                            >
                              Complete
                            </button>
                          )}
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </section>

              {/* Create form */}
              <section className="panel create-panel">
                <div className="panel-header">
                  <div>
                    <h2>Create a check-in</h2>
                    <p>Add a new family reminder.</p>
                  </div>
                </div>

                <form onSubmit={addCheckIn}>
                  <label htmlFor="checkin-name">Check-in name</label>
                  <input
                    id="checkin-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Evening check-in"
                    required
                  />

                  <label htmlFor="person">Family member</label>
                  <select id="person" value={person} onChange={(e) => setPerson(e.target.value)}>
                    <option>Dad</option>
                    <option>Mom</option>
                    <option>Grandparent</option>
                    <option>Other family member</option>
                  </select>

                  <label htmlFor="time">Reminder time</label>
                  <input
                    id="time"
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    required
                  />

                  <button className="primary-button" type="submit" disabled={saving}>
                    {saving ? "Creating..." : "+ Create check-in"}
                  </button>
                </form>

                <div className="privacy-note">
                  <span>&#9432;</span>
                  <p>
                    Check-ins are saved locally in the CareCue database. Scheduled notifications are not configured yet.
                  </p>
                </div>
              </section>
            </div>

            <section className="activity-panel" id="activity">
              <div>
                <h2>Care activity</h2>
                <p>Current check-in summary</p>
              </div>
              <div className="activity-summary">
                <span className="activity-dot" />
                <p>
                  {completed} of {checkIns.length} check-ins marked complete.
                  {pending > 0
                    ? ` ${pending} still awaiting completion.`
                    : " All listed check-ins are complete."}
                </p>
              </div>
            </section>
          </>
        )}

        {/*  CHAT TAB  */}
        {activeTab === "chat" && (
          <div className="chat-page">
            <div className="chat-page-header">
              <h1 className="chat-page-title">Ask CareCue</h1>
              <p className="chat-page-sub">
                Manage family check-ins with plain English.
              </p>
            </div>
            <ChatPanel onCheckInsChanged={handleCheckInsChanged} />
          </div>
        )}

        <footer>CareCue &middot; A little care goes a long way.</footer>
      </main>
    </div>
  );
}

export default App;
