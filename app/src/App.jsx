import { useState, useCallback } from "react";

const C = {
  bg: "#0B0F1A", surface: "#111827", border: "#1E2A3A", accent: "#00E5FF",
  ok: "#00C48C", warn: "#FFB547", danger: "#FF3B5C", text: "#E2EAF0",
  textDim: "#8A9BAE", muted: "#4B6278", p0: "#FF3B5C", p1: "#FF6B35", p2: "#FFB547",
};
const PRIORITIES = ["P0", "P1", "P2"];
const CUSTOMER_TYPES = ["PAYGE", "Services", "Credit"];
const PRIORITY_META = {
  P0: { color: C.p0, label: "P0 – Critical" },
  P1: { color: C.p1, label: "P1 – High" },
  P2: { color: C.p2, label: "P2 – Medium" },
};
const CT_META = {
  PAYGE:    { color: "#A78BFA", label: "PAYGE" },
  Services: { color: "#34D399", label: "Services" },
  Credit:   { color: "#60A5FA", label: "Credit" },
};

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const firstLine = lines[0];
  const sep = firstLine.includes("\t") ? "\t" : firstLine.includes(";") ? ";" : ",";
  const splitLine = (line) => {
    if (sep !== ",") return line.split(sep).map((c) => c.replace(/^"|"$/g, "").trim());
    const cols = []; let cur = "", inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === "," && !inQ) { cols.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    cols.push(cur.trim()); return cols;
  };
  const headers = splitLine(firstLine);
  return lines.slice(1).map((line) => {
    if (!line.trim()) return null;
    const cols = splitLine(line); const row = {};
    headers.forEach((h, i) => (row[h] = (cols[i] ?? "").trim()));
    return row;
  }).filter(Boolean);
}

function detectLabels(labelStr) {
  const parts = (labelStr || "").toUpperCase().split(",").map((l) => l.trim());
  const priorities = new Set(); const customerTypes = new Set();
  for (const part of parts) {
    if (part.includes("_P0") || part === "P0") priorities.add("P0");
    if (part.includes("_P1") || part === "P1") priorities.add("P1");
    if (part.includes("_P2") || part === "P2") priorities.add("P2");
    if (part.includes("PAYGE"))    customerTypes.add("PAYGE");
    if (part.includes("SERVICES")) customerTypes.add("Services");
    if (part.includes("CREDIT"))   customerTypes.add("Credit");
  }
  return { priorities: [...priorities], customerTypes: [...customerTypes] };
}

function isAutomation(row) { return (row["Author name"] || "").toLowerCase().includes("automation"); }
function isAgentMsg(row) { return !isAutomation(row) && (row["Falcon user name"] || "").trim() !== ""; }
function isCustomerMsg(row) { return !isAutomation(row) && !isAgentMsg(row); }

function calcMetrics(rows) {
  const convMap = {};
  for (const row of rows) {
    const id = row["Conversation ID"]; if (!id) continue;
    if (!convMap[id]) convMap[id] = []; convMap[id].push(row);
  }
  const responses = [];
  for (const msgs of Object.values(convMap)) {
    const sorted = [...msgs].sort((a, b) => new Date(a["Date created (UTC)"]) - new Date(b["Date created (UTC)"]));
    const allLabels = sorted.map((m) => m["Label"] || "").join(",");
    const { priorities, customerTypes } = detectLabels(allLabels);
    for (let i = 0; i < sorted.length; i++) {
      if (!isCustomerMsg(sorted[i])) continue;
      const nextAgent = sorted.slice(i + 1).find(isAgentMsg);
      if (!nextAgent) continue;
      const minutes = (new Date(nextAgent["Date created (UTC)"]) - new Date(sorted[i]["Date created (UTC)"])) / 60000;
      if (minutes >= 0 && minutes < 20160) responses.push({ minutes, priorities, customerTypes });
    }
  }
  return { responses, totalConversations: Object.keys(convMap).length, totalMessages: rows.length };
}

function buildReport(responses) {
  const table = {};
  for (const p of PRIORITIES) {
    table[p] = {};
    for (const ct of CUSTOMER_TYPES) {
      const matching = responses.filter((r) => r.priorities.includes(p) && r.customerTypes.includes(ct));
      if (!matching.length) { table[p][ct] = null; continue; }
      const w30 = matching.filter((r) => r.minutes <= 30).length;
      const w60 = matching.filter((r) => r.minutes <= 60).length;
      table[p][ct] = {
        total: matching.length, within30: w30, within60: w60,
        pct30: Math.round((w30 / matching.length) * 100),
        pct60: Math.round((w60 / matching.length) * 100),
        avgMins: Math.round(matching.reduce((s, r) => s + r.minutes, 0) / matching.length),
      };
    }
  }
  return table;
}

function PctBar({ pct, color }) {
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ background: C.border, borderRadius: 3, height: 4 }}>
        <div style={{ width: `${pct}%`, background: color, borderRadius: 3, height: 4, transition: "width 0.5s ease" }} />
      </div>
    </div>
  );
}

function SLACell({ data }) {
  if (!data) return <td style={{ padding: "14px 16px", textAlign: "center", color: C.muted, fontSize: 12, borderBottom: `1px solid ${C.border}` }}>—</td>;
  const color30 = data.pct30 >= 80 ? C.ok : data.pct30 >= 50 ? C.warn : C.danger;
  const color60 = data.pct60 >= 80 ? C.ok : data.pct60 >= 50 ? C.warn : C.danger;
  return (
    <td style={{ padding: "14px 16px", borderBottom: `1px solid ${C.border}`, verticalAlign: "top" }}>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>{data.total} responses · avg {data.avgMins}m</div>
      <div style={{ display: "flex", gap: 14 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: C.textDim, marginBottom: 2 }}>Within 30 min</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: color30, lineHeight: 1 }}>{data.pct30}%</div>
          <div style={{ fontSize: 10, color: C.muted, marginTop: 1, marginBottom: 2 }}>{data.within30}/{data.total}</div>
          <PctBar pct={data.pct30} color={color30} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: C.textDim, marginBottom: 2 }}>Within 60 min</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: color60, lineHeight: 1 }}>{data.pct60}%</div>
          <div style={{ fontSize: 10, color: C.muted, marginTop: 1, marginBottom: 2 }}>{data.within60}/{data.total}</div>
          <PctBar pct={data.pct60} color={color60} />
        </div>
      </div>
    </td>
  );
}

export default function App() {
  const [csvFile, setCsvFile] = useState(null);
  const [status, setStatus] = useState("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [report, setReport] = useState(null);
  const [summary, setSummary] = useState(null);

  const handleFile = useCallback((e) => {
    const file = e.target.files[0]; if (!file) return;
    setCsvFile(file.name); setStatus("idle"); setReport(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const rows = parseCSV(ev.target.result);
        if (!rows.length) throw new Error("No data rows found — check the file format.");
        const { responses, totalConversations, totalMessages } = calcMetrics(rows);
        setReport(buildReport(responses));
        setSummary({ totalMessages, totalConversations, responses: responses.length });
        setStatus("done");
      } catch (err) { setErrorMsg(err.message); setStatus("error"); }
    };
    reader.readAsText(file);
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'DM Sans','Segoe UI',sans-serif", padding: "32px 24px" }}>
      <div style={{ maxWidth: 920, margin: "0 auto" }}>

        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 32 }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: "linear-gradient(135deg,#00E5FF,#0099AA)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>⚡</div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em" }}>Engage Priority SLA Report</div>
            <div style={{ fontSize: 12, color: C.textDim }}>Centrica / British Gas · Brandwatch Engage export analyser</div>
          </div>
        </div>

        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "20px 24px", marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.accent, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Upload Engage Export</div>
          <div style={{ fontSize: 13, color: C.textDim, marginBottom: 16, lineHeight: 1.6 }}>
            Export your conversations from Brandwatch Engage and upload the file below. Auto-detects tab, semicolon, or comma-separated formats.
          </div>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, background: C.border, border: `1px dashed ${C.accent}55`, borderRadius: 6, padding: "10px 18px", cursor: "pointer", fontSize: 13 }}>
            <span>📂</span>
            <span style={{ color: C.accent }}>{csvFile || "Choose CSV / export file…"}</span>
            <input type="file" accept=".csv,.tsv,.txt" onChange={handleFile} style={{ display: "none" }} />
          </label>
          {status === "error" && (
            <div style={{ marginTop: 14, background: "#FF3B5C22", border: "1px solid #FF3B5C55", borderRadius: 6, padding: "10px 14px", fontSize: 12, color: "#FF3B5C" }}>⚠ {errorMsg}</div>
          )}
        </div>

        {status === "done" && summary && (
          <div style={{ display: "flex", gap: 14, marginBottom: 24, flexWrap: "wrap" }}>
            {[
              { label: "Messages", value: summary.totalMessages.toLocaleString() },
              { label: "Conversations", value: summary.totalConversations.toLocaleString() },
              { label: "Response Pairs", value: summary.responses.toLocaleString() },
            ].map(({ label, value }) => (
              <div key={label} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "14px 20px", flex: 1, minWidth: 130 }}>
                <div style={{ fontSize: 11, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: C.accent }}>{value}</div>
              </div>
            ))}
          </div>
        )}

        {status === "done" && report && (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>SLA Breakdown by Priority &amp; Customer Type</div>
              <div style={{ fontSize: 12, color: C.textDim, marginTop: 3 }}>% of agent responses within 30 and 60 minutes of the customer message</div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr style={{ background: C.bg }}>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, color: C.textDim, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap", width: 170 }}>Priority</th>
                    {CUSTOMER_TYPES.map((ct) => (
                      <th key={ct} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, color: CT_META[ct].color, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{CT_META[ct].label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PRIORITIES.map((p) => (
                    <tr key={p}>
                      <td style={{ padding: "14px 16px", borderBottom: `1px solid ${C.border}`, verticalAlign: "middle", whiteSpace: "nowrap" }}>
                        <span style={{ background: PRIORITY_META[p].color + "22", color: PRIORITY_META[p].color, border: `1px solid ${PRIORITY_META[p].color}55`, borderRadius: 4, padding: "4px 10px", fontSize: 12, fontWeight: 700, fontFamily: "monospace" }}>
                          {PRIORITY_META[p].label}
                        </span>
                      </td>
                      {CUSTOMER_TYPES.map((ct) => <SLACell key={ct} data={report[p][ct]} />)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: "12px 20px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 16, flexWrap: "wrap", fontSize: 11, color: C.textDim, alignItems: "center" }}>
              <span><span style={{ color: C.ok }}>■</span> ≥80% on target</span>
              <span><span style={{ color: C.warn }}>■</span> 50–79%</span>
              <span><span style={{ color: C.danger }}>■</span> &lt;50%</span>
              <span style={{ marginLeft: "auto" }}>Automated welcome messages excluded from SLA calculations.</span>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}