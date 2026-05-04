"use strict";

const $ = id => document.getElementById(id);

// ── Safe DOM helpers ───────────────────────────────────────────
// Never use innerHTML — build real nodes instead.

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "style") node.style.cssText = v;
    else if (k === "className") node.className = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) {
    if (child == null) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function span(cls, text, style) {
  const s = document.createElement("span");
  if (cls)   s.className   = cls;
  if (style) s.style.cssText = style;
  if (text != null) s.textContent = text;
  return s;
}

function strong(text, style) {
  const s = document.createElement("strong");
  s.textContent = text;
  if (style) s.style.cssText = style;
  return s;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// ── Theme persistence ──────────────────────────────────────────
const THEME_KEY = "robots-radar-theme";

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  $("themeIcon").textContent = theme === "dark" ? "🌙" : "☀️";
  try { localStorage.setItem(THEME_KEY, theme); } catch {}
}

function initTheme() {
  let saved;
  try { saved = localStorage.getItem(THEME_KEY); } catch {}
  if (!saved) {
    saved = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  applyTheme(saved);
}

$("themeToggle").addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme");
  applyTheme(current === "dark" ? "light" : "dark");
});

// ── Syntax-highlight robots.txt (DOM nodes, no innerHTML) ──────
// Maps a raw robots.txt line to a DOM node with coloured spans.
function highlightLine(line) {
  const p = document.createElement("div");

  // Comment line
  if (/^\s*#/.test(line)) {
    p.appendChild(span("s-comment", line));
    return p;
  }

  const ci = line.indexOf(":");
  if (ci === -1) {
    p.appendChild(document.createTextNode(line));
    return p;
  }

  const key   = line.slice(0, ci);
  const colon = ":";
  const value = line.slice(ci + 1);
  const keyLower = key.toLowerCase();

  const CLASS_MAP = {
    "user-agent": "s-agent",
    "allow":      "s-allow",
    "disallow":   "s-disallow",
    "sitemap":    "s-sitemap",
  };
  const keyCls = CLASS_MAP[keyLower] || null;

  if (keyCls) {
    p.appendChild(span(keyCls, key));
    p.appendChild(span("s-key", colon));
    p.appendChild(document.createTextNode(value));
  } else if (keyLower === "crawl-delay") {
    p.appendChild(span("s-key", key + colon));
    p.appendChild(document.createTextNode(value));
  } else {
    p.appendChild(document.createTextNode(line));
  }
  return p;
}

function renderHighlightedSource(container, text) {
  clear(container);
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    container.appendChild(highlightLine(line));
  }
}

// ── Bot analysis description (DOM nodes, no innerHTML) ─────────
function makeBotDesc(groupSource, botName) {
  const desc = el("span", { style: "font-size:10.5px;color:var(--muted);line-height:1.4;" });

  if (groupSource === "explicit") {
    desc.appendChild(document.createTextNode("Rules for "));
    desc.appendChild(strong(botName, "color:var(--blue)"));
    desc.appendChild(span(null, " (explicit group)", "color:var(--muted2)"));
  } else if (groupSource === "wildcard") {
    desc.appendChild(document.createTextNode("No explicit group for target bots — using "));
    desc.appendChild(strong("* wildcard", "color:var(--blue)"));
    desc.appendChild(document.createTextNode(" fallback"));
  } else {
    desc.appendChild(document.createTextNode("No user-agent group found — path is "));
    desc.appendChild(strong("implicitly allowed", "color:var(--green)"));
  }
  return desc;
}

// ── Render the winning rule card ───────────────────────────────
function renderBotAnalysis(botAnalysis) {
  const list = $("ruleList");
  clear(list);

  const { botName, groupSource, winningRule } = botAnalysis || {};

  // Source pill row
  const sourceRow = el("div", {
    style: "display:flex;align-items:center;gap:7px;margin-bottom:8px;flex-wrap:wrap;"
  });
  const iconMap = { explicit: "🤖", wildcard: "🌐", none: "📭" };
  sourceRow.appendChild(el("span",
    { style: "font-size:13px;flex-shrink:0;" },
    iconMap[groupSource] || "📭"
  ));
  sourceRow.appendChild(makeBotDesc(groupSource, botName));
  list.appendChild(sourceRow);

  // No rule matched
  if (!winningRule) {
    const empty = el("div", { className: "empty-rules" });
    if (groupSource !== "none") {
      empty.appendChild(document.createTextNode("No rule in the "));
      empty.appendChild(el("code",
        { style: "font-size:10px;color:var(--blue);" },
        botName
      ));
      empty.appendChild(document.createTextNode(" group matched this path — implicitly allowed."));
    } else {
      empty.textContent = "No crawl restrictions apply to this path.";
    }
    list.appendChild(empty);
    return;
  }

  // Winning rule card
  const isAllow = winningRule.type === "allow";
  const rc      = isAllow ? "rgba(74,222,128,.35)" : "rgba(220,38,38,.35)";
  const row     = el("div", { className: "rule-row", style: `border-color:${rc};` });

  // Top line: dot · path · badge
  const topLine = el("div", { style: "display:flex;align-items:center;gap:8px;width:100%;" });

  const dot = el("span", { className: `rule-dot ${winningRule.type}` });

  const pathEl = el("span", { className: "rule-path" }, winningRule.path || "(empty)");

  const badgeStyle = [
    "font-size:8.5px;font-weight:700;letter-spacing:.5px;",
    "padding:2px 7px;border-radius:4px;text-transform:uppercase;",
    `background:${isAllow ? "rgba(22,163,74,.12)" : "rgba(220,38,38,.12)"};`,
    `color:${isAllow ? "var(--green)" : "var(--red)"};`,
    "white-space:nowrap;flex-shrink:0;"
  ].join("");
  const badge = el("span", { style: badgeStyle }, isAllow ? "Allow" : "Disallow");

  topLine.append(dot, pathEl, badge);

  // Specificity bar
  const specLine = el("div", { style: [
    "display:flex;align-items:center;gap:7px;",
    "margin-top:8px;padding-top:7px;",
    "border-top:1px solid var(--border);"
  ].join("") });

  const specLbl = el("span", {
    style: "font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;white-space:nowrap;"
  }, "Specificity");

  const barWrap = el("div", { className: "spec-bar-wrap" });
  const bar     = el("div", { className: `spec-bar ${winningRule.type}` });
  const pct     = Math.min(100, Math.max(5, (winningRule.length || 1) * 4 + 8));
  bar.style.width = "0";
  requestAnimationFrame(() => { bar.style.width = pct + "%"; });
  barWrap.appendChild(bar);

  const specVal = el("span", {
    style: "font-size:9px;color:var(--muted);white-space:nowrap;"
  }, `${winningRule.length} chars`);

  specLine.append(specLbl, barWrap, specVal);
  row.append(topLine, specLine);
  list.appendChild(row);
}

// ── Full render ────────────────────────────────────────────────
function render(result) {
  if (!result) {
    $("heroIcon").className   = "hero-icon scanning";
    $("heroIcon").textContent = "📡";
    $("heroLabel").className  = "hero-label scanning";
    $("heroLabel").textContent = "Scanning…";
    $("heroPath").textContent  = "Waiting for background analysis";
    $("fetchInfo").textContent = "—";
    return;
  }

  const { status, hostname, pathname, stats, botAnalysis,
          text, hasRobots, fromCache, fetchedAt, error } = result;

  const META = {
    allowed:    { icon: "✅", label: "Allowed",     cls: "allowed"    },
    open:       { icon: "🌐", label: "Open Access",  cls: "open"       },
    disallowed: { icon: "🚫", label: "Disallowed",  cls: "disallowed" },
    error:      { icon: "❓", label: "Fetch Error", cls: "error"      },
  };
  const meta = META[status] || META.error;

  $("heroIcon").className   = `hero-icon ${meta.cls}`;
  $("heroIcon").textContent = meta.icon;
  $("heroLabel").className  = `hero-label ${meta.cls}`;
  $("heroLabel").textContent = meta.label;

  // Host + path (no innerHTML — build nodes)
  const heroPath = $("heroPath");
  clear(heroPath);
  const hostNode = el("span", { className: "hero-host" }, hostname);
  heroPath.appendChild(hostNode);
  heroPath.appendChild(document.createTextNode(pathname || "/"));

  // Cache badge
  const cacheBadge = $("cacheBadge");
  cacheBadge.style.display = "block";
  if (fromCache) {
    const age = fetchedAt ? Math.round((Date.now() - fetchedAt) / 1000) : "?";
    cacheBadge.textContent = `⚡ ${age}s ago`;
    cacheBadge.className   = "cache-badge cached";
  } else {
    cacheBadge.textContent = "🔴 live";
    cacheBadge.className   = "cache-badge live";
  }

  // Error state
  if (status === "error") {
    $("errorBox").style.display     = "block";
    $("errorBox").textContent       = `⚠️ ${error || "Unknown error"}`;
    $("statsRow").style.display     = "none";
    $("ruleSection").style.display  = "none";
    $("viewerHeader").style.display = "none";
    $("fetchInfo").textContent      = "Fetch failed";
    return;
  }
  $("errorBox").style.display = "none";

  // Stats
  $("statsRow").style.display   = "flex";
  $("statAllow").textContent    = stats?.allow    ?? "—";
  $("statDisallow").textContent = stats?.disallow ?? "—";
  $("statAgents").textContent   = stats?.agents   ?? "—";

  // Rule
  $("ruleSection").style.display = "block";
  renderBotAnalysis(botAnalysis);

  // Source viewer — safe DOM rendering, no innerHTML
  if (text?.trim()) {
    $("viewerHeader").style.display = "flex";
    renderHighlightedSource($("viewerContent"), text);
  } else {
    $("viewerHeader").style.display = "none";
  }

  // Footer timing
  if (fetchedAt) {
    const elapsed = Date.now() - fetchedAt;
    const bytes   = text?.length ?? 0;
    $("fetchInfo").textContent = fromCache
      ? `Cached ${Math.round(elapsed / 1000)}s ago · ${bytes}B`
      : `Fetched ${elapsed < 2000 ? elapsed + "ms" : Math.round(elapsed / 1000) + "s"} ago · ${bytes}B`;
  }
}

// ── Source viewer toggle ───────────────────────────────────────
$("toggleBtn").addEventListener("click", () => {
  const open = $("viewer").classList.toggle("open");
  $("toggleBtn").textContent = open ? "Hide source ▴" : "Show source ▾";
});

// ── Refresh ────────────────────────────────────────────────────
$("refreshBtn").addEventListener("click", async () => {
  $("heroIcon").className   = "hero-icon scanning";
  $("heroIcon").textContent = "📡";
  $("heroLabel").className  = "hero-label scanning";
  $("heroLabel").textContent = "Refreshing…";
  $("cacheBadge").style.display = "none";

  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]?.url) {
    await browser.runtime.sendMessage({ type: "CLEAR_CACHE", url: tabs[0].url });
    setTimeout(async () => render(
      await browser.runtime.sendMessage({ type: "GET_ANALYSIS" })
    ), 800);
  }
});

// ── Boot ───────────────────────────────────────────────────────
initTheme();
(async () => render(await browser.runtime.sendMessage({ type: "GET_ANALYSIS" })))();
