import { useState, useCallback } from "react";

// ─── Colour tokens ────────────────────────────────────────────────────────────
const C = {
  bg: "#0B0F1A",
  surface: "#111827",
  border: "#1E2A3A",
  accent: "#00E5FF",
  accentDim: "#0099AA",
  warn: "#FF6B35",
  ok: "#00C48C",
  muted: "#4B6278",
  text: "#E2EAF0",
  textDim: "#8A9BAE",
  p0: "#FF3B5C",
  p1: "#FF6B35",
  p2: "#FFB547",
  none: "#4B6278",
};

// ─── Priority colours ─────────────────────────────────────────────────────────
const PRIORITY_META = {
  P0: { color: C.p0, label: "P0 – Critical" },
  P1: { color: C.p1, label: "P1 – High" },
  P2: { color: C.p2, label: "P2 – Medium" },
  NONE: { color: C.none, label: "No Priority" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.replace(/^"|"$/g, "").trim());
  return lines.slice(1).map((line) => {
    // naive CSV split – handles quoted commas
    const cols = [];
    let cur = "";
    let inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === "," && !inQ) { cols.push(cur); cur = ""; continue; }
      cur += ch;
    }
    cols.push(cur);
    const row = {};
    headers.forEach((h, i) => (row[h] = cols[i] ?? ""));
    return row;
  });
}

function detectPriority(row) {
  const label = (row["Label"] || row["label"] || "").toUpperCase();
  const priority = (row["Priority"] || row["priority"] || "").toUpperCase();
  const combined = label + " " + priority;
  if (combined.includes("P0")) return "P0";
  if (combined.includes("P1")) return "P1";
  if (combined.includes("P2")) return "P2";
  return null;
}

/**
 * Core algorithm: propagate the last seen priority label forward
 * within each conversation thread (ordered by date).
 */
function propagatePriorities(rows) {
  // Group by conversation ID
  const conv = {};
  for (const r of rows) {
    const id = r["Conversation ID"] || r["conversation_id"] || r["ConversationID"] || "unknown";
    if (!conv[id]) conv[id] = [];
    conv[id].push(r);
  }

  const enriched = [];
  for (const [convId, msgs] of Object.entries(conv)) {
    // Sort chronologically
    const sorted = [...msgs].sort((a, b) => {
      const da = new Date(a["Date created (UTC)"] || a["date_created"] || 0);
      const db = new Date(b["Date created (UTC)"] || b["date_created"] || 0);
      return da - db;
    });

    let lastPriority = null;
    for (const msg of sorted) {
      const explicit = detectPriority(msg);
      if (explicit) lastPriority = explicit;
      enriched.push({
        ...msg,
        _conversationId: convId,
        _priority: lastPriority || "NONE",
        _prioritySource: explicit ? "explicit" : lastPriority ? "propagated" : "none",
      });
    }
  }
  return enriched;
}

/**
 * Calculate first-response time per conversation, grouped by priority.
 * "First response" = first agent message after first customer message.
 */
function calcMetrics(rows) {
  const conv = {};
  for (const r of rows) {
    const id = r._conversationId;
    if (!conv[id]) conv[id] = { priority: r._priority, msgs: [] };
    conv[id].msgs.push(r);
  }

  const byPriority = { P0: [], P1: [], P2: [], NONE: [] };

  for (const { priority, msgs } of Object.values(conv)) {
    const sorted = [...msgs].sort(
      (a, b) =>
        new Date(a["Date created (UTC)"] || 0) - new Date(b["Date created (UTC)"] || 0)
    );

    // Find first customer message and first subsequent agent message
    const isAgent = (m) => {
      const smu = m["Social Media Management username"] || m["smm_username"] || "";
      const author = m["Author name"] || m["author_name"] || "";
      // If SMM username is populated → agent; else customer
      return smu.trim() !== "";
    };

    const firstCustomer = sorted.find((m) => !isAgent(m));
    if (!firstCustomer) continue;
    const custTime = new Date(firstCustomer["Date created (UTC)"] || 0);
    const firstAgent = sorted.find(
      (m) => isAgent(m) && new Date(m["Date created (UTC)"] || 0) > custTime
    );

    if (!firstAgent) continue;
    const agentTime = new Date(firstAgent["Date created (UTC)"] || 0);
    const responseMinutes = (agentTime - custTime) / 60000;
    if (responseMinutes < 0) continue;

    byPriority[priority]?.push(responseMinutes);
  }

  const stats = {};
  for (const [p, times] of Object.entries(byPriority)) {
    if (!times.length) { stats[p] = null; continue; }
    const sorted = [...times].sort((a, b) => a - b);
    const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p90 = sorted[Math.floor(sorted.length * 0.9)];
    stats[p] = { count: times.length, avg, p50, p90, min: sorted[0], max: sorted[sorted.length - 1] };
  }
  return stats;
}

function fmtTime(mins) {
  if (mins == null) return "—";
  if (mins < 60) return `${Math.round(mins)}m`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h}h ${m}m`;
}

// ─── Fake API call simulation (replace with real fetch) ───────────────────────
async function callEngageAPI(config) {
  // In production, replace this with:
  //
  // const createRes = await fetch("https://api.brandwatch.com/engage/v1/exports", {
  //   method: "POST",
  //   headers: { Authorization: `Bearer ${config.apiToken}`, "Content-Type": "application/json" },
  //   body: JSON.stringify({
  //     startDate: config.startDate,
  //     endDate: config.endDate,
  //     networks: config.networks,
  //     types: ["post","comment","reply","dm"],
  //   }),
  // });
  // const { uuid } = await createRes.json();
  //
  // // Poll for export readiness
  // let csvUrl;
  // for (let i = 0; i < 20; i++) {
  //   await new Promise(r => setTimeout(r, 3000));
  //   const poll = await fetch(`https://api.brandwatch.com/engage/v1/exports/${uuid}`, {
  //     headers: { Authorization: `Bearer ${config.apiToken}` }
  //   });
  //   const data = await poll.json();
  //   if (data.status === "DONE") { csvUrl = data.url; break; }
  // }
  // const csv = await (await fetch(csvUrl)).text();
  // return csv;

  throw new Error("DEMO_MODE");
}

// ─── Components ───────────────────────────────────────────────────────────────
const Tag = ({ color, children }) => (
  <span style={{
    background: color + "22",
    color,
    border: `1px solid ${color}55`,
    borderRadius: 4,
    padding: "2px 8px",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    fontFamily: "monospace",
  }}>{children}</span>
);

const Card = ({ children, style }) => (
  <div style={{
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    padding: "20px 24px",
    ...style,
  }}>{children}</div>
);

const MetricCard = ({ priority, stats }) => {
  const meta = PRIORITY_META[priority];
  if (!stats) return (
    <Card style={{ opacity: 0.4 }}>
      <Tag color={meta.color}>{priority}</Tag>
      <div style={{ color: C.textDim, marginTop: 12, fontSize: 13 }}>No data</div>
    </Card>
  );

  const bars = [
    { label: "Avg", value: stats.avg, max: stats.max },
    { label: "P50", value: stats.p50, max: stats.max },
    { label: "P90", value: stats.p90, max: stats.max },
  ];

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Tag color={meta.color}>{meta.label}</Tag>
        <span style={{ color: C.textDim, fontSize: 12 }}>{stats.count} conversations</span>
      </div>

      <div style={{ fontSize: 32, fontWeight: 800, color: meta.color, fontFamily: "'DM Mono', monospace", marginBottom: 4 }}>
        {fmtTime(stats.p50)}
        <span style={{ fontSize: 13, fontWeight: 400, color: C.textDim, marginLeft: 8 }}>median</span>
      </div>

      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        {bars.map(({ label, value, max }) => (
          <div key={label}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.textDim, marginBottom: 3 }}>
              <span>{label}</span><span style={{ color: C.text }}>{fmtTime(value)}</span>
            </div>
            <div style={{ background: C.border, borderRadius: 3, height: 4 }}>
              <div style={{
                width: `${Math.min(100, (value / max) * 100)}%`,
                background: meta.color,
                borderRadius: 3,
                height: 4,
                transition: "width 0.6s ease",
              }} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
};

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("config"); // config | results | raw
  const [config, setConfig] = useState({
    apiToken: "",
    startDate: "",
    endDate: "",
    networks: ["facebook", "instagram", "twitter"],
  });
  const [status, setStatus] = useState(null); // null | loading | error | done
  const [errorMsg, setErrorMsg] = useState("");
  const [metrics, setMetrics] = useState(null);
  const [enrichedRows, setEnrichedRows] = useState([]);
  const [csvFile, setCsvFile] = useState(null);

  const networkOptions = ["facebook", "instagram", "twitter", "tiktok", "youtube", "whatsapp", "google"];

  const toggleNetwork = (n) =>
    setConfig((c) => ({
      ...c,
      networks: c.networks.includes(n) ? c.networks.filter((x) => x !== n) : [...c.networks, n],
    }));

  const processCSV = useCallback((csvText) => {
    const rows = parseCSV(csvText);
    if (!rows.length) { setErrorMsg("CSV appears empty or malformed."); setStatus("error"); return; }
    const enriched = propagatePriorities(rows);
    const m = calcMetrics(enriched);
    setEnrichedRows(enriched);
    setMetrics(m);
    setStatus("done");
    setTab("results");
  }, []);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setCsvFile(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => processCSV(ev.target.result);
    reader.readAsText(file);
  };

  const handleFetchAPI = async () => {
    setStatus("loading");
    setErrorMsg("");
    try {
      const csv = await callEngageAPI(config);
      processCSV(csv);
    } catch (e) {
      if (e.message === "DEMO_MODE") {
        setErrorMsg("API call is stubbed. Please upload a CSV export from Engage to analyse data, or replace the callEngageAPI() function with your real credentials.");
      } else {
        setErrorMsg(e.message);
      }
      setStatus("error");
    }
  };

  // Priority distribution counts
  const priorityCounts = enrichedRows.reduce((acc, r) => {
    acc[r._priority] = (acc[r._priority] || 0) + 1;
    return acc;
  }, {});

  const propagatedCount = enrichedRows.filter((r) => r._prioritySource === "propagated").length;

  return (
    <div style={{
      minHeight: "100vh",
      background: C.bg,
      color: C.text,
      fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
      padding: "32px 24px",
    }}>
      {/* Header */}
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8,
            background: `linear-gradient(135deg, ${C.accent}, ${C.accentDim})`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18,
          }}>⚡</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em" }}>
              Engage Priority SLA Analyser
            </div>
            <div style={{ fontSize: 12, color: C.textDim }}>Brandwatch Engage → Response time metrics by priority tier</div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginTop: 28, marginBottom: 24, borderBottom: `1px solid ${C.border}`, paddingBottom: 0 }}>
          {[
            { id: "config", label: "⚙ Configuration" },
            { id: "results", label: "📊 SLA Metrics", disabled: !metrics },
            { id: "raw", label: "🗂 Enriched Data", disabled: !enrichedRows.length },
          ].map(({ id, label, disabled }) => (
            <button
              key={id}
              onClick={() => !disabled && setTab(id)}
              style={{
                background: "none",
                border: "none",
                borderBottom: tab === id ? `2px solid ${C.accent}` : "2px solid transparent",
                color: tab === id ? C.accent : disabled ? C.muted : C.textDim,
                cursor: disabled ? "default" : "pointer",
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: tab === id ? 700 : 400,
                marginBottom: -1,
              }}
            >{label}</button>
          ))}
        </div>

        {/* ── CONFIG TAB ── */}
        {tab === "config" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <Card>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.accent, marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                How it works
              </div>
              <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.7 }}>
                <div style={{ display: "flex", gap: 12, marginBottom: 8 }}>
                  <span style={{ color: C.accent, fontWeight: 700 }}>1.</span>
                  <span>Export your Engage conversation data via the API or upload a CSV export directly.</span>
                </div>
                <div style={{ display: "flex", gap: 12, marginBottom: 8 }}>
                  <span style={{ color: C.accent, fontWeight: 700 }}>2.</span>
                  <span>Priority labels (P0/P1/P2) are detected on the initial customer message in each conversation.</span>
                </div>
                <div style={{ display: "flex", gap: 12, marginBottom: 8 }}>
                  <span style={{ color: C.accent, fontWeight: 700 }}>3.</span>
                  <span><strong style={{ color: C.text }}>Priority propagation:</strong> All subsequent messages within a Conversation ID inherit the last known priority label, enabling accurate thread-level SLA measurement.</span>
                </div>
                <div style={{ display: "flex", gap: 12 }}>
                  <span style={{ color: C.accent, fontWeight: 700 }}>4.</span>
                  <span>First-response time is calculated per conversation and aggregated by priority tier.</span>
                </div>
              </div>
            </Card>

            {/* Upload CSV */}
            <Card>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.accent, marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Option A — Upload CSV Export
              </div>
              <div style={{ fontSize: 12, color: C.textDim, marginBottom: 12 }}>
                Download your export from Engage (Feeds → Export) and upload it here. The CSV must include columns: <code style={{ color: C.accent }}>Conversation ID</code>, <code style={{ color: C.accent }}>Date created (UTC)</code>, <code style={{ color: C.accent }}>Label</code>, <code style={{ color: C.accent }}>Social Media Management username</code>.
              </div>
              <label style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                background: C.border, border: `1px dashed ${C.accent}55`,
                borderRadius: 6, padding: "10px 18px", cursor: "pointer", fontSize: 13,
              }}>
                <span>📂</span>
                <span style={{ color: C.accent }}>{csvFile ? csvFile : "Choose CSV file…"}</span>
                <input type="file" accept=".csv" onChange={handleFileUpload} style={{ display: "none" }} />
              </label>
            </Card>

            {/* API Config */}
            <Card>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.accent, marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Option B — Fetch via Engage API
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
                {[
                  { label: "API Token", key: "apiToken", placeholder: "Bearer token…", type: "password" },
                  { label: "Start Date", key: "startDate", placeholder: "YYYY-MM-DD", type: "date" },
                  { label: "End Date", key: "endDate", placeholder: "YYYY-MM-DD", type: "date" },
                ].map(({ label, key, placeholder, type }) => (
                  <div key={key} style={key === "apiToken" ? { gridColumn: "1 / -1" } : {}}>
                    <div style={{ fontSize: 11, color: C.textDim, marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
                    <input
                      type={type}
                      placeholder={placeholder}
                      value={config[key]}
                      onChange={(e) => setConfig((c) => ({ ...c, [key]: e.target.value }))}
                      style={{
                        width: "100%", boxSizing: "border-box",
                        background: C.bg, border: `1px solid ${C.border}`,
                        borderRadius: 6, padding: "9px 12px",
                        color: C.text, fontSize: 13, outline: "none",
                      }}
                    />
                  </div>
                ))}
              </div>

              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: C.textDim, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Networks</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {networkOptions.map((n) => {
                    const active = config.networks.includes(n);
                    return (
                      <button key={n} onClick={() => toggleNetwork(n)} style={{
                        background: active ? C.accent + "22" : C.border,
                        border: `1px solid ${active ? C.accent : C.border}`,
                        color: active ? C.accent : C.textDim,
                        borderRadius: 5, padding: "5px 12px", fontSize: 12,
                        cursor: "pointer", fontWeight: active ? 700 : 400, textTransform: "capitalize",
                      }}>{n}</button>
                    );
                  })}
                </div>
              </div>

              <button
                onClick={handleFetchAPI}
                disabled={status === "loading"}
                style={{
                  background: `linear-gradient(135deg, ${C.accent}, ${C.accentDim})`,
                  border: "none", borderRadius: 7, padding: "10px 24px",
                  color: "#000", fontWeight: 800, fontSize: 13, cursor: "pointer",
                  opacity: status === "loading" ? 0.6 : 1,
                }}
              >
                {status === "loading" ? "⏳ Fetching…" : "▶ Fetch & Analyse"}
              </button>

              {status === "error" && (
                <div style={{ marginTop: 12, background: C.p0 + "22", border: `1px solid ${C.p0}55`, borderRadius: 6, padding: "10px 14px", fontSize: 12, color: C.p0 }}>
                  ⚠ {errorMsg}
                </div>
              )}
            </Card>
          </div>
        )}

        {/* ── RESULTS TAB ── */}
        {tab === "results" && metrics && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Summary bar */}
            <Card style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 11, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Total Messages</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: C.accent }}>{enrichedRows.length.toLocaleString()}</div>
              </div>
              {Object.entries(priorityCounts).map(([p, cnt]) => (
                <div key={p}>
                  <div style={{ fontSize: 11, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{p} Messages</div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: PRIORITY_META[p]?.color || C.text }}>{cnt.toLocaleString()}</div>
                </div>
              ))}
              <div>
                <div style={{ fontSize: 11, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Propagated Labels</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: C.ok }}>{propagatedCount.toLocaleString()}</div>
              </div>
            </Card>

            {/* Propagation note */}
            <div style={{ background: C.ok + "11", border: `1px solid ${C.ok}33`, borderRadius: 8, padding: "10px 16px", fontSize: 12, color: C.ok }}>
              ✓ Priority propagation applied: {propagatedCount.toLocaleString()} messages inherited their conversation's priority label, enabling full-thread SLA analysis.
            </div>

            {/* Metric cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
              {["P0", "P1", "P2", "NONE"].map((p) => (
                <MetricCard key={p} priority={p} stats={metrics[p]} />
              ))}
            </div>

            {/* Interpretation guide */}
            <Card>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.accent, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Reading these metrics
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 12, color: C.textDim, lineHeight: 1.6 }}>
                <div><strong style={{ color: C.text }}>Median (P50)</strong> — Half of conversations received a first response faster than this. The headline SLA number.</div>
                <div><strong style={{ color: C.text }}>P90</strong> — 90% of conversations received a first response within this time. Catches outliers / worst-case SLA.</div>
                <div><strong style={{ color: C.text }}>Avg</strong> — Mean first-response time. Can be skewed by outliers; prefer P50/P90 for SLA reporting.</div>
                <div><strong style={{ color: C.text }}>Propagated labels</strong> — Messages that had no explicit priority tag but inherited one from earlier in the same conversation thread.</div>
              </div>
            </Card>
          </div>
        )}

        {/* ── RAW DATA TAB ── */}
        {tab === "raw" && enrichedRows.length > 0 && (
          <div>
            <div style={{ fontSize: 12, color: C.textDim, marginBottom: 12 }}>
              Showing first 200 rows of {enrichedRows.length.toLocaleString()} enriched messages. <code style={{ color: C.accent }}>_priority</code> = computed priority tier. <code style={{ color: C.accent }}>_prioritySource</code> = explicit | propagated | none.
            </div>
            <div style={{ overflowX: "auto", borderRadius: 8, border: `1px solid ${C.border}` }}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11 }}>
                <thead>
                  <tr style={{ background: C.surface }}>
                    {["_conversationId", "_priority", "_prioritySource",
                      "Author name", "Social Media Management username",
                      "Content type", "Date created (UTC)", "Content"].map((h) => (
                      <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: C.accent, fontWeight: 700, whiteSpace: "nowrap", borderBottom: `1px solid ${C.border}` }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {enrichedRows.slice(0, 200).map((r, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? C.bg : C.surface }}>
                      {["_conversationId", "_priority", "_prioritySource",
                        "Author name", "Social Media Management username",
                        "Content type", "Date created (UTC)", "Content"].map((k) => (
                        <td key={k} style={{ padding: "6px 12px", color: k === "_priority" ? (PRIORITY_META[r[k]]?.color || C.text) : C.textDim, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", borderBottom: `1px solid ${C.border}22` }}>
                          {r[k]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}