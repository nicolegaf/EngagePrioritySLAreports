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

const ENGAGE_NETWORKS = new Set([
  "facebook", "twitter", "instagram", "youtube", "linkedin",
  "tiktok", "whatsapp", "telegram", "google", "trustpilot", "appstore", "googleplay",
]);

function splitBySep(line, sep) {
  const cols = []; let cur = "", inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === sep && !inQ) { cols.push(cur.replace(/^"|"$/g, "").trim()); cur = ""; }
    else cur += ch;
  }
  cols.push(cur.replace(/^"|"$/g, "").trim());
  return cols;
}

function parseCSV(text) {
  const rawLines = text.split(/\r?\n/);
  if (rawLines.length < 2) return [];

  const headerLine = rawLines[0];
  const sep = headerLine.includes(";") ? ";" : headerLine.includes("\t") ? "\t" : ",";
  const headers = splitBySep(headerLine, sep);

  const networkColIdx = headers.findIndex((h) => h.toLowerCase() === "network");

  const isRecordStart = (line) => {
    if (!line.trim()) return false;
    const parts = line.split(sep);
    if (networkColIdx > 0) {
      const firstVal = (parts[0] || "").replace(/"/g, "").trim();
      if (!/^\d+$/.test(firstVal)) return false;
      const netVal = (parts[networkColIdx] || "").replace(/"/g, "").toLowerCase().trim();
      return netVal.length > 0 && /^[a-z]+$/.test(netVal);
    }
    if (networkColIdx === 0) {
      const netVal = (parts[0] || "").replace(/"/g, "").toLowerCase().trim();
      return netVal.length > 0 && netVal.length <= 20 && /^[a-z]+$/.test(netVal);
    }
    const lower = line.trimStart().toLowerCase();
    return [...ENGAGE_NETWORKS].some((n) => lower.startsWith(n + sep));
  };

  let reconstructed = [];
  let current = null;
  for (let i = 1; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (!line.trim()) continue;
    if (isRecordStart(line)) {
      if (current !== null) reconstructed.push(current);
      current = line;
    } else if (current !== null) {
      current += " " + line.trim();
    }
  }
  if (current !== null) reconstructed.push(current);

  const sourceLines = reconstructed.length ? reconstructed : rawLines.slice(1).filter((l) => l.trim());

  return sourceLines.map((line) => {
    const cols = splitBySep(line, sep);
    const row = {};
    headers.forEach((h, i) => (row[h] = (cols[i] ?? "").trim()));
    return row;
  });
}

function parseDate(str) {
  if (!str || !str.trim()) return new Date(NaN);
  const s = str.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]));
  return new Date(s);
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

const BIZ_SCHEDULES = {
  PAYGE:    [null,   [8,20], [8,20], [8,20], [8,20], [8,20], [9,17]],
  Credit:   [null,   [8,20], [8,20], [8,20], [8,20], [8,20], [9,17]],
  Services: [[8,18], [8,20], [8,20], [8,20], [8,20], [8,20], [8,18]],
};

function getUKInfo(utcDate) {
  const parts = {};
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(utcDate).forEach(({ type, value }) => { parts[type] = +value; });
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/London", weekday: "short",
  }).format(utcDate);
  parts.dow = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[wd] ?? 0;
  return parts;
}

function londonOffset(utcDate) {
  const ukH = +new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", hour: "2-digit", hour12: false,
  }).formatToParts(utcDate).find((p) => p.type === "hour").value;
  let off = ukH - utcDate.getUTCHours();
  if (off < -12) off += 24;
  if (off > 12) off -= 24;
  return off;
}

function makeUTC(year, month, day, ukHour, ukMinute) {
  const est = new Date(Date.UTC(year, month - 1, day, ukHour, ukMinute));
  const off = londonOffset(est);
  return new Date(Date.UTC(year, month - 1, day, ukHour - off, ukMinute));
}

function bizHoursElapsed(startUTC, endUTC, customerType) {
  const schedule = BIZ_SCHEDULES[customerType];
  if (!schedule || endUTC <= startUTC) return Math.max(0, (endUTC - startUTC) / 60000);
  let totalMinutes = 0;
  const uk0 = getUKInfo(startUTC);
  let probe = makeUTC(uk0.year, uk0.month, uk0.day, 0, 0);
  for (let d = 0; d < 30 && probe < endUTC; d++) {
    const uk = getUKInfo(probe);
    const hours = schedule[uk.dow];
    if (hours) {
      const [openH, closeH] = hours;
      const dayOpen  = makeUTC(uk.year, uk.month, uk.day, openH,  0);
      const dayClose = makeUTC(uk.year, uk.month, uk.day, closeH, 0);
      const overlapStart = startUTC > dayOpen  ? startUTC : dayOpen;
      const overlapEnd   = endUTC   < dayClose ? endUTC   : dayClose;
      if (overlapEnd > overlapStart) totalMinutes += (overlapEnd - overlapStart) / 60000;
    }
    const next = new Date(probe.getTime() + 25 * 3600000);
    const ukNext = getUKInfo(next);
    probe = makeUTC(ukNext.year, ukNext.month, ukNext.day, 0, 0);
  }
  return totalMinutes;
}

function isIrrelevant(row) {
  return (row["Label"] || row["Labels"] || "").toLowerCase().includes("irrelevant");
}
function isAgentMsg(row) {
  const author = (row["Author name"] || "").trim().toLowerCase();
  return author.includes("british gas") || author.includes("automation");
}
function isCustomerMsg(row) {
  return !isAgentMsg(row) && !isIrrelevant(row);
}

function getReportMonth(rows) {
  for (const row of rows) {
    const t = parseDate(row["Date created (UTC)"]);
    if (!isNaN(t)) return { year: t.getUTCFullYear(), month: t.getUTCMonth() };
  }
  return null;
}

function inReportMonth(date, reportMonth) {
  return date.getUTCFullYear() === reportMonth.year && date.getUTCMonth() === reportMonth.month;
}

function inAllowedAgentMonth(date, reportMonth) {
  const nextMonth = reportMonth.month === 11
    ? { year: reportMonth.year + 1, month: 0 }
    : { year: reportMonth.year, month: reportMonth.month + 1 };
  return inReportMonth(date, reportMonth) || inReportMonth(date, nextMonth);
}

function calcMetrics(rows) {
  const reportMonth = getReportMonth(rows);
  const convMap = {};
  for (const row of rows) {
    const id = row["Parent comment ID"] || row["Conversation ID"]; if (!id) continue;
    if (!convMap[id]) convMap[id] = []; convMap[id].push(row);
  }
  const responses = [];
  for (const msgs of Object.values(convMap)) {
    const sorted = [...msgs].sort((a, b) => parseDate(a["Date created (UTC)"]) - parseDate(b["Date created (UTC)"]));

    let searchFrom = new Date(0);

    while (true) {
      const customer = sorted.find((m) => {
        if (!isCustomerMsg(m)) return false;
        const t = parseDate(m["Date created (UTC)"]);
        if (isNaN(t) || t <= searchFrom) return false;
        if (reportMonth && !inReportMonth(t, reportMonth)) return false;
        const hasRecentAgentReply = sorted.some(
          (a) => isAgentMsg(a) && parseDate(a["Date created (UTC)"]) < t &&
                 t - parseDate(a["Date created (UTC)"]) < 24 * 60 * 60 * 1000
        );
        if (hasRecentAgentReply) return false;
        const { priorities, customerTypes } = detectLabels(m["Label"] || m["Labels"] || "");
        return priorities.length > 0 && customerTypes.length > 0;
      });
      if (!customer) break;

      const customerTime = parseDate(customer["Date created (UTC)"]);
      const { priorities, customerTypes } = detectLabels(customer["Label"] || customer["Labels"] || "");

      const agentReply = sorted.find((m) => {
        if (!isAgentMsg(m)) return false;
        const t = parseDate(m["Date created (UTC)"]);
        if (t < customerTime) return false;
        if (reportMonth && !inAllowedAgentMonth(t, reportMonth)) return false;
        return true;
      });
      if (!agentReply) break;

      const agentTime = parseDate(agentReply["Date created (UTC)"]);
      const convId = customer["Conversation ID"];
      const url = customer["URL"] || customer["Permalink"] || customer["Falcon URL"]
        || `https://app.falcon.io/#/engage/${convId}/${convId}`;

      const ct = customerTypes[0] ?? null;
      const minutes = bizHoursElapsed(customerTime, agentTime, ct);
      if (minutes < 20160) {
        responses.push({
          id: `${url}-${customerTime.getTime()}`,
          minutes, priorities, customerTypes,
          date: customerTime,
          content: customer["Content"] || "",
          network: customer["Network"] || "",
          url,
        });
      }

      searchFrom = agentTime;
    }
  }
  const reportMonthLabel = reportMonth
    ? new Date(Date.UTC(reportMonth.year, reportMonth.month, 1))
        .toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })
    : null;
  return { responses, totalConversations: Object.keys(convMap).length, totalMessages: rows.length, reportMonthLabel };
}

function calcJacksData(rows, reportMonth) {
  const convMap = {};
  for (const row of rows) {
    const id = row["Parent comment ID"] || row["Conversation ID"]; if (!id) continue;
    if (!convMap[id]) convMap[id] = []; convMap[id].push(row);
  }
  const items = [];
  for (const msgs of Object.values(convMap)) {
    const sorted = [...msgs].sort((a, b) => parseDate(a["Date created (UTC)"]) - parseDate(b["Date created (UTC)"]));
    let searchFrom = new Date(0);
    while (true) {
      const customer = sorted.find((m) => {
        if (!isCustomerMsg(m)) return false;
        const t = parseDate(m["Date created (UTC)"]);
        if (isNaN(t) || t <= searchFrom) return false;
        if (reportMonth && !inReportMonth(t, reportMonth)) return false;
        const hasRecentAgentReply = sorted.some(
          (a) => isAgentMsg(a) && parseDate(a["Date created (UTC)"]) < t &&
                 t - parseDate(a["Date created (UTC)"]) < 24 * 60 * 60 * 1000
        );
        return !hasRecentAgentReply;
      });
      if (!customer) break;
      const customerTime = parseDate(customer["Date created (UTC)"]);
      const { customerTypes, priorities } = detectLabels(customer["Label"] || customer["Labels"] || "");
      const convId = customer["Conversation ID"];
      const url = customer["URL"] || customer["Permalink"] || customer["Falcon URL"]
        || `https://app.falcon.io/#/engage/${convId}/${convId}`;
      const content = customer["Content"] || "";
      const network = customer["Network"] || "";
      const agentReply = sorted.find((m) => {
        if (!isAgentMsg(m)) return false;
        const t = parseDate(m["Date created (UTC)"]);
        if (t < customerTime) return false;
        if (reportMonth && !inAllowedAgentMonth(t, reportMonth)) return false;
        return true;
      });
      if (agentReply) {
        const agentTime = parseDate(agentReply["Date created (UTC)"]);
        const ct = customerTypes[0] ?? null;
        const minutes = bizHoursElapsed(customerTime, agentTime, ct);
        items.push({ answered: true, minutes, customerTypes, priorities, date: customerTime, content, network, url });
        searchFrom = agentTime;
      } else {
        items.push({ answered: false, minutes: null, customerTypes, priorities, date: customerTime, content, network, url });
        break;
      }
    }
  }
  return items;
}

function jacksStats(items, ctFilter) {
  const filtered = ctFilter ? items.filter((r) => r.customerTypes.includes(ctFilter)) : items;
  const received = filtered.length;
  const answeredItems = filtered.filter((r) => r.answered);
  const within30 = answeredItems.filter((r) => r.minutes <= 30).length;
  const outside30 = answeredItems.filter((r) => r.minutes > 30).length;
  const notAnswered = filtered.filter((r) => !r.answered).length;
  const answered = answeredItems.length;
  const pct = (n) => received > 0 ? Math.round((n / received) * 100 * 10) / 10 : 0;
  return { received, answered, within30, outside30, notAnswered, pct };
}

function JacksTab({ items }) {
  const [priorityFilter, setPriorityFilter] = useState("P0");
  const [answeredFilter, setAnsweredFilter] = useState("answered");

  const priorityFiltered = priorityFilter === "all"
    ? items
    : items.filter((i) => i.priorities.includes(priorityFilter));

  const filteredItems = answeredFilter === "answered"
    ? priorityFiltered.filter((i) => i.answered)
    : priorityFiltered;

  const cols = [
    { key: null,        label: "All contacts" },
    { key: "Credit",    label: "Credit energy" },
    { key: "PAYGE",     label: "PAYGE" },
    { key: "Services",  label: "Services" },
  ];
  const data = cols.map(({ key, label }) => ({ label, ...jacksStats(filteredItems, key) }));

  const cell = (content, bold, sub, color) => ({
    padding: sub ? "8px 16px 8px 28px" : "12px 16px",
    borderBottom: `1px solid ${C.border}`,
    fontSize: bold ? 13 : 12,
    fontWeight: bold ? 700 : 400,
    color: color || (sub ? C.textDim : C.text),
    whiteSpace: "nowrap",
  });

  const allRows = [
    { label: "Received",               bold: true,  sub: false, answeredOnly: false, val: (d) => d.received.toLocaleString() },
    { label: "Answered",               bold: true,  sub: false, answeredOnly: false, val: (d) => `${d.answered.toLocaleString()} (${d.pct(d.answered)}%)` },
    { label: "↳ Within 30 biz mins",   bold: false, sub: true,  answeredOnly: false, val: (d) => `${d.within30.toLocaleString()} (${d.pct(d.within30)}%)` },
    { label: "↳ Outside 30 biz mins",  bold: false, sub: true,  answeredOnly: false, val: (d) => `${d.outside30.toLocaleString()} (${d.pct(d.outside30)}%)` },
    { label: "Not answered",           bold: true,  sub: false, answeredOnly: true,  val: (d) => `${d.notAnswered.toLocaleString()} (${d.pct(d.notAnswered)}%)` },
    { label: "% Answered",             bold: true,  sub: false, answeredOnly: false, val: (d) => `${d.pct(d.answered)}%` },
    { label: "% Within 30 biz mins",   bold: true,  sub: false, answeredOnly: false, val: (d) => `${d.pct(d.within30)}%` },
    { label: "% Outside 30 biz mins",  bold: true,  sub: false, answeredOnly: false, val: (d) => `${d.pct(d.outside30)}%` },
    { label: "% Not answered",         bold: true,  sub: false, answeredOnly: true,  val: (d) => `${d.pct(d.notAnswered)}%` },
  ];
  const rows = answeredFilter === "answered" ? allRows.filter((r) => !r.answeredOnly) : allRows;

  return (
    <div>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: C.textDim }}>Priority:</span>
          <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 5, padding: "4px 10px", fontSize: 12, fontFamily: "inherit", cursor: "pointer" }}>
            <option value="all">All priorities</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: C.textDim }}>Responded status:</span>
          <select value={answeredFilter} onChange={(e) => setAnsweredFilter(e.target.value)} style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 5, padding: "4px 10px", fontSize: 12, fontFamily: "inherit", cursor: "pointer" }}>
            <option value="answered">Answered only</option>
            <option value="all">All messages</option>
          </select>
        </div>
        <span style={{ fontSize: 11, color: C.textDim }}>{filteredItems.length} of {items.length} messages</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
          <thead>
            <tr style={{ background: C.bg }}>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, color: C.textDim, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap", minWidth: 200 }}></th>
              {data.map((d) => (
                <th key={d.label} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, color: C.accent, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{d.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ label, bold, sub, val }) => (
              <tr key={label} style={{ background: sub ? C.bg + "88" : "transparent" }}>
                <td style={cell(null, bold, sub)}>{label}</td>
                {data.map((d) => (
                  <td key={d.label} style={cell(val(d), bold, sub)}>{val(d)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UnansweredTab({ items }) {
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [ctFilter, setCtFilter] = useState("all");

  const unanswered = items.filter((i) => !i.answered);

  const visible = unanswered
    .filter((i) => priorityFilter === "all" || i.priorities.includes(priorityFilter))
    .filter((i) => ctFilter === "all" || i.customerTypes.includes(ctFilter))
    .sort((a, b) => b.date - a.date);

  const fmtDate = (d) => (!d || isNaN(d)) ? "—" : d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <div>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: C.textDim }}>Priority:</span>
          <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 5, padding: "4px 10px", fontSize: 12, fontFamily: "inherit", cursor: "pointer" }}>
            <option value="all">All priorities</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: C.textDim }}>Customer type:</span>
          <select value={ctFilter} onChange={(e) => setCtFilter(e.target.value)} style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 5, padding: "4px 10px", fontSize: 12, fontFamily: "inherit", cursor: "pointer" }}>
            <option value="all">All types</option>
            {CUSTOMER_TYPES.map((ct) => <option key={ct} value={ct}>{ct}</option>)}
          </select>
        </div>
        <span style={{ fontSize: 11, color: C.textDim }}>{visible.length} of {unanswered.length} unanswered</span>
      </div>
      {visible.length === 0 ? (
        <div style={{ padding: "40px 0", textAlign: "center", color: C.ok, fontSize: 14 }}>✓ No unanswered messages for this filter.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead>
              <tr style={{ background: C.bg }}>
                {["Date", "Network", "Priority", "Customer Type", "First Customer Message", "Link"].map((h) => (
                  <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, color: C.textDim, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((r, idx) => (
                <tr key={idx} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: "10px 14px", color: C.textDim, whiteSpace: "nowrap", verticalAlign: "top" }}>{fmtDate(r.date)}</td>
                  <td style={{ padding: "10px 14px", color: C.textDim, whiteSpace: "nowrap", verticalAlign: "top", textTransform: "capitalize" }}>{r.network || "—"}</td>
                  <td style={{ padding: "10px 14px", verticalAlign: "top", whiteSpace: "nowrap" }}>
                    {r.priorities.length > 0
                      ? r.priorities.map((p) => <LabelPill key={p} label={p} color={PRIORITY_META[p]?.color ?? C.textDim} />)
                      : <span style={{ color: C.muted, fontSize: 11 }}>None</span>}
                  </td>
                  <td style={{ padding: "10px 14px", verticalAlign: "top", whiteSpace: "nowrap" }}>
                    {r.customerTypes.length > 0
                      ? r.customerTypes.map((ct) => <LabelPill key={ct} label={ct} color={CT_META[ct]?.color ?? C.textDim} />)
                      : <span style={{ color: C.muted, fontSize: 11 }}>None</span>}
                  </td>
                  <td style={{ padding: "10px 14px", color: C.text, maxWidth: 380, verticalAlign: "top" }}>
                    <span title={r.content}>{r.content.length > 100 ? r.content.slice(0, 100) + "…" : r.content || "—"}</span>
                  </td>
                  <td style={{ padding: "10px 14px", verticalAlign: "top", whiteSpace: "nowrap" }}>
                    <a href={r.url} target="_blank" rel="noreferrer" style={{ color: C.accent, fontSize: 12, textDecoration: "none" }}>Open ↗</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function OverTimeTab({ items }) {
  const dayMap = {};
  for (const item of items) {
    if (!item.date) continue;
    const day = item.date.toISOString().slice(0, 10);
    if (!dayMap[day]) dayMap[day] = [];
    dayMap[day].push(item);
  }
  const days = Object.keys(dayMap).sort();

  if (!days.length) {
    return <div style={{ padding: "40px 24px", textAlign: "center", color: C.textDim, fontSize: 13 }}>No data to display.</div>;
  }

  const series = [
    { key: null,       label: "All",      color: C.accent },
    { key: "Credit",   label: "Credit",   color: CT_META.Credit.color },
    { key: "PAYGE",    label: "PAYGE",    color: CT_META.PAYGE.color },
    { key: "Services", label: "Services", color: CT_META.Services.color },
  ];

  const seriesData = series.map(({ key, label, color }) => ({
    label, color,
    values: days.map((day) => {
      const di = dayMap[day] || [];
      return key ? di.filter((i) => i.customerTypes.includes(key)).length : di.length;
    }),
  }));

  const W = 860, H = 300;
  const pad = { top: 24, right: 24, bottom: 52, left: 44 };
  const cW = W - pad.left - pad.right;
  const cH = H - pad.top - pad.bottom;

  const maxVal = Math.max(...seriesData.flatMap((s) => s.values), 1);
  const yMax = Math.ceil(maxVal / 5) * 5 || 5;
  const yTicks = Math.min(yMax, 5);

  const xPos = (i) => pad.left + (days.length > 1 ? (i / (days.length - 1)) * cW : cW / 2);
  const yPos = (v) => pad.top + cH - (v / yMax) * cH;
  const showEvery = Math.max(1, Math.ceil(days.length / 12));

  return (
    <div style={{ padding: "20px 24px" }}>
      <div style={{ display: "flex", gap: 20, marginBottom: 20, flexWrap: "wrap" }}>
        {series.map(({ label, color }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.text }}>
            <div style={{ width: 24, height: 3, background: color, borderRadius: 2 }} />
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div style={{ overflowX: "auto" }}>
        <svg width={W} height={H} style={{ display: "block" }}>
          {Array.from({ length: yTicks + 1 }, (_, i) => {
            const v = Math.round((yMax / yTicks) * i);
            const y = yPos(v);
            return (
              <g key={i}>
                <line x1={pad.left} x2={pad.left + cW} y1={y} y2={y} stroke={C.border} strokeWidth={1} />
                <text x={pad.left - 8} y={y + 4} textAnchor="end" fontSize={10} fill={C.textDim}>{v}</text>
              </g>
            );
          })}
          {days.map((day, i) => {
            if (i % showEvery !== 0 && i !== days.length - 1) return null;
            return (
              <text key={day} x={xPos(i)} y={pad.top + cH + 18} textAnchor="middle" fontSize={10} fill={C.textDim}>{day.slice(5)}</text>
            );
          })}
          <line x1={pad.left} x2={pad.left} y1={pad.top} y2={pad.top + cH} stroke={C.border} strokeWidth={1} />
          <line x1={pad.left} x2={pad.left + cW} y1={pad.top + cH} y2={pad.top + cH} stroke={C.border} strokeWidth={1} />
          {seriesData.map(({ label, color, values }) => {
            const pts = values.map((v, i) => `${xPos(i)},${yPos(v)}`).join(" ");
            return (
              <g key={label}>
                <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
                {values.map((v, i) => <circle key={i} cx={xPos(i)} cy={yPos(v)} r={3} fill={color} />)}
              </g>
            );
          })}
        </svg>
      </div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>First messages per day (UTC) · customer types may overlap</div>
    </div>
  );
}

function calcStats(matching) {
  if (!matching.length) return null;
  const w30 = matching.filter((r) => r.minutes <= 30).length;
  const w60 = matching.filter((r) => r.minutes <= 60).length;
  const w90 = matching.filter((r) => r.minutes <= 90).length;
  return {
    total: matching.length, within30: w30, within60: w60, within90: w90,
    pct30: Math.round((w30 / matching.length) * 100),
    pct60: Math.round((w60 / matching.length) * 100),
    pct90: Math.round((w90 / matching.length) * 100),
    avgMins: Math.round(matching.reduce((s, r) => s + r.minutes, 0) / matching.length),
  };
}

function buildReport(responses) {
  const table = {};
  for (const p of PRIORITIES) {
    table[p] = {};
    for (const ct of CUSTOMER_TYPES) {
      table[p][ct] = calcStats(responses.filter((r) => r.priorities.includes(p) && r.customerTypes.includes(ct)));
    }
    table[p]["Total"] = calcStats(responses.filter((r) => r.priorities.includes(p)));
  }
  return table;
}

function fmtMins(m) {
  if (m < 60) return `${Math.round(m)}m`;
  const h = Math.floor(m / 60); const min = Math.round(m % 60);
  return min > 0 ? `${h}h ${min}m` : `${h}h`;
}

function slaBadge(minutes) {
  if (minutes <= 30) return { label: "Within 30m", color: C.ok };
  if (minutes <= 60) return { label: "31–60m", color: C.warn };
  if (minutes <= 90) return { label: "61–90m", color: C.warn };
  return { label: "Over 90m", color: C.danger };
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
  const color90 = data.pct90 >= 80 ? C.ok : data.pct90 >= 50 ? C.warn : C.danger;
  return (
    <td style={{ padding: "14px 16px", borderBottom: `1px solid ${C.border}`, verticalAlign: "top" }}>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>{data.total} responses · avg {fmtMins(data.avgMins)}</div>
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
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: C.textDim, marginBottom: 2 }}>Within 90 min</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: color90, lineHeight: 1 }}>{data.pct90}%</div>
          <div style={{ fontSize: 10, color: C.muted, marginTop: 1, marginBottom: 2 }}>{data.within90}/{data.total}</div>
          <PctBar pct={data.pct90} color={color90} />
        </div>
      </div>
    </td>
  );
}

function LabelPill({ label, color }) {
  return (
    <span style={{ background: color + "22", color, border: `1px solid ${color}55`, borderRadius: 4, padding: "2px 7px", fontSize: 11, fontWeight: 700, fontFamily: "monospace", marginRight: 4 }}>
      {label}
    </span>
  );
}

function BreachTable({ responses, priority, excluded, onExclude, onRestore }) {
  const breaches = responses
    .filter((r) => r.priorities.includes(priority) && r.minutes > 30)
    .sort((a, b) => b.minutes - a.minutes);

  const [ctFilter, setCtFilter] = useState("all");
  const visible = ctFilter === "all" ? breaches : breaches.filter((r) => r.customerTypes.includes(ctFilter));
  const excludedInTab = breaches.filter((r) => excluded.has(r.id)).length;

  const fmtDate = (d) => (!d || isNaN(d)) ? "—" : d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: C.textDim, marginRight: 4 }}>Customer type:</span>
        {["all", ...CUSTOMER_TYPES].map((f) => (
          <button key={f} onClick={() => setCtFilter(f)} style={{ padding: "5px 12px", borderRadius: 5, border: `1px solid ${ctFilter === f ? C.accent : C.border}`, background: ctFilter === f ? C.accent + "22" : "transparent", color: ctFilter === f ? C.accent : C.textDim, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
            {f === "all" ? `All (${breaches.length})` : f}
          </button>
        ))}
        {excludedInTab > 0 && (
          <span style={{ marginLeft: 8, fontSize: 12, color: C.muted }}>
            {excludedInTab} excluded ·{" "}
            <button onClick={() => breaches.forEach((r) => onRestore(r.id))} style={{ background: "none", border: "none", color: C.accent, fontSize: 12, cursor: "pointer", padding: 0, fontFamily: "inherit" }}>Reset</button>
          </span>
        )}
      </div>
      {visible.length === 0 ? (
        <div style={{ padding: "32px 0", textAlign: "center", color: C.ok, fontSize: 14 }}>✓ All {priority} responses were within 30 minutes.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead>
              <tr style={{ background: C.bg }}>
                {["Date", "Network", "Customer Type", "Response Time", "SLA Band", "First Customer Message", "Link", ""].map((h) => (
                  <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, color: C.textDim, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const badge = slaBadge(r.minutes);
                const isExcluded = excluded.has(r.id);
                return (
                  <tr key={r.id} style={{ borderBottom: `1px solid ${C.border}`, opacity: isExcluded ? 0.4 : 1 }}>
                    <td style={{ padding: "10px 14px", color: C.textDim, whiteSpace: "nowrap", verticalAlign: "top" }}>{fmtDate(r.date)}</td>
                    <td style={{ padding: "10px 14px", color: C.textDim, whiteSpace: "nowrap", verticalAlign: "top", textTransform: "capitalize" }}>{r.network}</td>
                    <td style={{ padding: "10px 14px", verticalAlign: "top", whiteSpace: "nowrap" }}>
                      {r.customerTypes.map((ct) => <LabelPill key={ct} label={ct} color={CT_META[ct]?.color ?? C.textDim} />)}
                    </td>
                    <td style={{ padding: "10px 14px", verticalAlign: "top", whiteSpace: "nowrap", fontWeight: 700, color: badge.color }}>{fmtMins(r.minutes)}</td>
                    <td style={{ padding: "10px 14px", verticalAlign: "top", whiteSpace: "nowrap" }}>
                      <span style={{ background: badge.color + "22", color: badge.color, border: `1px solid ${badge.color}55`, borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>{badge.label}</span>
                    </td>
                    <td style={{ padding: "10px 14px", color: C.text, maxWidth: 380, verticalAlign: "top" }}>
                      <span title={r.content}>{r.content.length > 100 ? r.content.slice(0, 100) + "…" : r.content}</span>
                    </td>
                    <td style={{ padding: "10px 14px", verticalAlign: "top", whiteSpace: "nowrap" }}>
                      <a href={r.url} target="_blank" rel="noreferrer" style={{ color: C.accent, fontSize: 12, textDecoration: "none" }}>Open ↗</a>
                    </td>
                    <td style={{ padding: "10px 14px", verticalAlign: "top", whiteSpace: "nowrap" }}>
                      {isExcluded
                        ? <button onClick={() => onRestore(r.id)} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 4, color: C.textDim, fontSize: 11, cursor: "pointer", padding: "2px 8px", fontFamily: "inherit" }}>Restore</button>
                        : <button onClick={() => onExclude(r.id)} style={{ background: "none", border: `1px solid ${C.danger}55`, borderRadius: 4, color: C.danger, fontSize: 11, cursor: "pointer", padding: "2px 8px", fontFamily: "inherit" }}>Exclude</button>
                      }
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const PASSWORD = "BritishGas2025";

function LockScreen({ onUnlock }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);

  const attempt = () => {
    if (input === PASSWORD) { onUnlock(); }
    else { setError(true); setInput(""); }
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans','Segoe UI',sans-serif" }}>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "40px 48px", width: 340, textAlign: "center" }}>
        <div style={{ width: 48, height: 48, borderRadius: 12, background: "linear-gradient(135deg,#00E5FF,#0099AA)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, margin: "0 auto 20px" }}>⚡</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: C.text, marginBottom: 4 }}>Engage SLA Report</div>
        <div style={{ fontSize: 12, color: C.textDim, marginBottom: 28 }}>Centrica / British Gas · Internal tool</div>
        <input
          type="password"
          value={input}
          onChange={(e) => { setInput(e.target.value); setError(false); }}
          onKeyDown={(e) => e.key === "Enter" && attempt()}
          placeholder="Enter password"
          autoFocus
          style={{ width: "100%", boxSizing: "border-box", background: C.bg, border: `1px solid ${error ? C.danger : C.border}`, borderRadius: 6, padding: "10px 14px", color: C.text, fontSize: 14, fontFamily: "inherit", outline: "none", marginBottom: 10 }}
        />
        {error && <div style={{ fontSize: 12, color: C.danger, marginBottom: 10 }}>Incorrect password</div>}
        <button onClick={attempt} style={{ width: "100%", background: C.accent, border: "none", borderRadius: 6, padding: "10px 0", color: C.bg, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
          Unlock
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [unlocked, setUnlocked] = useState(false);
  const [csvFile, setCsvFile] = useState(null);
  const [status, setStatus] = useState("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [allResponses, setAllResponses] = useState([]);
  const [excluded, setExcluded] = useState(new Set());
  const [summary, setSummary] = useState(null);
  const [jacksData, setJacksData] = useState([]);
  const [tab, setTab] = useState("jacks");

  const handleFile = useCallback((e) => {
    const file = e.target.files[0]; if (!file) return;
    setCsvFile(file.name); setStatus("idle"); setAllResponses([]); setExcluded(new Set()); setJacksData([]);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const rows = parseCSV(ev.target.result);
        if (!rows.length) throw new Error("No data rows found — check the file format.");
        const { responses: resp, totalConversations, totalMessages, reportMonthLabel } = calcMetrics(rows);
        const reportMonth = getReportMonth(rows);
        setAllResponses(resp);
        setJacksData(calcJacksData(rows, reportMonth));
        setSummary({ totalMessages, totalConversations, responses: resp.length, reportMonthLabel });
        setStatus("done");
      } catch (err) { setErrorMsg(err.message); setStatus("error"); }
    };
    reader.readAsText(file);
  }, []);

  const handleExclude = useCallback((id) => setExcluded((prev) => new Set([...prev, id])), []);
  const handleRestore = useCallback((id) => setExcluded((prev) => { const n = new Set(prev); n.delete(id); return n; }), []);

  const responses = allResponses.filter((r) => !excluded.has(r.id));
  const report = status === "done" ? buildReport(responses) : null;

  const tabs = [
    { id: "jacks", label: "All 1st Messages" },
    { id: "sla", label: "SLA Report" },
    ...PRIORITIES.map((p) => ({
      id: p,
      label: `${p} Breaches (${responses.filter((r) => r.priorities.includes(p) && r.minutes > 30).length})`,
      color: PRIORITY_META[p].color,
    })),
    { id: "unanswered", label: `Unanswered (${jacksData.filter((i) => !i.answered).length})`, color: C.danger },
    { id: "overtime", label: "Over Time" },
  ];

  if (!unlocked) return <LockScreen onUnlock={() => setUnlocked(true)} />;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'DM Sans','Segoe UI',sans-serif", padding: "32px 24px" }}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>

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
              { label: "Report Month", value: summary.reportMonthLabel || "—" },
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

        {status === "done" && (
          <div style={{ display: "flex", gap: 4, marginBottom: 16, flexWrap: "wrap" }}>
            {tabs.map(({ id, label, color }) => (
              <button key={id} onClick={() => setTab(id)} style={{ padding: "8px 18px", borderRadius: "6px 6px 0 0", border: `1px solid ${tab === id ? (color || C.accent) : C.border}`, borderBottom: tab === id ? `1px solid ${C.surface}` : `1px solid ${C.border}`, background: tab === id ? C.surface : "transparent", color: tab === id ? (color || C.accent) : C.textDim, fontSize: 13, fontWeight: tab === id ? 700 : 400, cursor: "pointer", fontFamily: "inherit" }}>
                {label}
              </button>
            ))}
          </div>
        )}

        {status === "done" && tab === "sla" && report && (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: "0 6px 10px 10px", overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>SLA Breakdown by Priority &amp; Customer Type</div>
              <div style={{ fontSize: 12, color: C.textDim, marginTop: 3 }}>% of first responses within 30, 60 and 90 minutes · business hours only</div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr style={{ background: C.bg }}>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, color: C.textDim, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap", width: 170 }}>Priority</th>
                    {CUSTOMER_TYPES.map((ct) => (
                      <th key={ct} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, color: CT_META[ct].color, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{CT_META[ct].label}</th>
                    ))}
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, color: C.accent, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>Total</th>
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
                      <SLACell data={report[p]["Total"]} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: "12px 20px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 16, flexWrap: "wrap", fontSize: 11, color: C.textDim, alignItems: "center" }}>
              <span><span style={{ color: C.ok }}>■</span> ≥80% on target</span>
              <span><span style={{ color: C.warn }}>■</span> 50–79%</span>
              <span><span style={{ color: C.danger }}>■</span> &lt;50%</span>
              <span style={{ marginLeft: "auto" }}>First response · business hours elapsed only · irrelevant excluded</span>
            </div>
          </div>
        )}

        {status === "done" && PRIORITIES.includes(tab) && (
          <div style={{ background: C.surface, border: `1px solid ${PRIORITY_META[tab].color}55`, borderRadius: "0 6px 10px 10px", padding: "20px 24px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <span style={{ background: PRIORITY_META[tab].color + "22", color: PRIORITY_META[tab].color, border: `1px solid ${PRIORITY_META[tab].color}55`, borderRadius: 4, padding: "3px 10px", fontSize: 12, fontWeight: 700, fontFamily: "monospace" }}>{tab}</span>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>SLA Breaches — responses over 30 minutes</div>
            </div>
            <div style={{ fontSize: 12, color: C.textDim, marginBottom: 16 }}>Sorted by longest response time first. These conversations are included in the SLA report above.</div>
            <BreachTable responses={allResponses} priority={tab} excluded={excluded} onExclude={handleExclude} onRestore={handleRestore} />
          </div>
        )}

        {status === "done" && tab === "jacks" && (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: "0 6px 10px 10px", overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>All 1st Messages</div>
              <div style={{ fontSize: 12, color: C.textDim, marginTop: 3 }}>All first customer messages from the report month · irrespective of priority · business hours only</div>
            </div>
            <JacksTab items={jacksData} />
          </div>
        )}

        {status === "done" && tab === "unanswered" && (
          <div style={{ background: C.surface, border: `1px solid ${C.danger}55`, borderRadius: "0 6px 10px 10px", overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Unanswered Messages</div>
              <div style={{ fontSize: 12, color: C.textDim, marginTop: 3 }}>First customer messages from the report month with no agent reply · sorted newest first</div>
            </div>
            <UnansweredTab items={jacksData} />
          </div>
        )}

        {status === "done" && tab === "overtime" && (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: "0 6px 10px 10px", overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>First Messages Over Time</div>
              <div style={{ fontSize: 12, color: C.textDim, marginTop: 3 }}>Total qualifying first messages per day, broken down by customer type</div>
            </div>
            <OverTimeTab items={jacksData} />
          </div>
        )}

      </div>
    </div>
  );
}