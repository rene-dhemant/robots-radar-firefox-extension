"use strict";

// ═══════════════════════════════════════════════════════════════
//  ROBOTS RADAR — Background Script v2
//  Owns: fetch cache · robots.txt parser · animated address-bar icons
// ═══════════════════════════════════════════════════════════════

// ── Cache ──────────────────────────────────────────────────────
const domainCache = new Map(); // hostname -> { text, groups, fetchedAt, ok }
const tabResults  = new Map(); // tabId   -> analysisResult
const animations  = new Map(); // tabId   -> intervalId
const CACHE_TTL   = 60 * 60 * 1000;

// ── Target bots (priority order) ───────────────────────────────
const TARGET_BOTS = ["googlebot", "bingbot", "ccbot", "google-extended"];

// ── Agent normalisation ────────────────────────────────────────
// Google strips version info and wildcards from user-agent values:
//   "Googlebot/2.1" → "googlebot"
//   "googlebot*"    → "googlebot"
function normalizeAgent(raw) {
  return raw
    .toLowerCase()
    .replace(/\/.*$/, "")   // strip "/version"
    .replace(/\*/g, "")     // strip wildcards
    .trim();
}

// ── Parser (Googlebot relaxed mode) ───────────────────────────
// Key differences from strict REP:
//  • Blank lines do NOT terminate a group — only a new User-agent line after
//    rules does. This matches Googlebot's documented "relaxed" behaviour.
//  • Non-allow/disallow/user-agent directives are skipped (not group-separators).
//  • Multiple groups with the same effective user-agent are kept separate
//    here; they are merged at query time (see getRulesForBot).
function parseRobotsTxt(text) {
  const groups  = [];
  let   current = null;

  for (const raw of text.split(/\r?\n/)) {
    // Strip inline comments and trim whitespace (BOM is also stripped this way)
    const line = raw.replace(/#.*$/, "").replace(/^\xEF\xBB\xBF/, "").trim();
    if (!line) continue; // relaxed: blank lines ignored inside records

    const ci = line.indexOf(":");
    if (ci === -1) continue; // malformed line — skip

    const key   = line.slice(0, ci).trim().toLowerCase();
    const value = line.slice(ci + 1).trim();

    if (key === "user-agent") {
      // Start a new group only when the current one already has rules.
      // This allows multiple consecutive User-agent lines to share one rule block.
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value);

    } else if (key === "allow" || key === "disallow") {
      if (!current) {
        // Rules before any User-agent — attach to implicit wildcard group
        current = { agents: ["*"], rules: [] };
        groups.push(current);
      }
      // Empty path → ignore the rule entirely (spec: "crawlers ignore rules without a path")
      // An empty Disallow is NOT "allow all"; it just adds no restriction.
      if (value !== "") {
        current.rules.push({ type: key, path: value });
      }
      // else: empty Allow/Disallow → skip silently

    }
    // All other directives (sitemap, crawl-delay, host …) are intentionally ignored.
    // Per Google spec, they do NOT act as group terminators.
  }

  return groups;
}

// ── Path matching ──────────────────────────────────────────────
// Converts a robots.txt path pattern into a RegExp and tests urlPath.
// Rules per Google spec:
//   • Matching is case-sensitive.
//   • The pattern must match from the start of the path (implicit ^).
//   • * matches 0 or more of any character.
//   • $ anchors the end of the URL (only meaningful at end of pattern).
//   • A pattern with no wildcards must match a PREFIX of the URL path.
function buildPatternRegex(pattern) {
  let reStr = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") {
      reStr += ".*";
    } else if (ch === "$" && i === pattern.length - 1) {
      reStr += "$"; // end-of-string anchor
    } else {
      // Escape all regex metacharacters except the ones we handle above
      reStr += ch.replace(/[\\^$.|+?(){}\[\]\\\\]/g, "\\$&");
    }
  }
  return new RegExp(reStr);
}

const _regexCache = new Map();
function matchesPath(pattern, urlPath) {
  if (!_regexCache.has(pattern)) {
    try { _regexCache.set(pattern, buildPatternRegex(pattern)); }
    catch { return false; }
  }
  return _regexCache.get(pattern).test(urlPath);
}

// ── Rule selection ────────────────────────────────────────────
// Given a list of rules for one logical agent group (already merged),
// return the single winning rule for urlPath.
//
// Priority (Google spec + RFC 9309):
//   1. Longest raw path length wins (more specific).
//   2. Equal length → Allow beats Disallow (least restrictive).
//   3. No match → null (implicitly allowed).
function bestRule(rules, urlPath) {
  let winner = null;

  for (const rule of rules) {
    if (!matchesPath(rule.path, urlPath)) continue;

    const len = rule.path.length; // raw length, wildcards included

    if (
      !winner ||
      len > winner.length ||
      (len === winner.length && rule.type === "allow" && winner.type !== "allow")
    ) {
      winner = { type: rule.type, path: rule.path, length: len };
    }
  }

  return winner; // null → no rule matched → path is implicitly allowed
}

// ── Group lookup and merging ──────────────────────────────────
// Per Google spec: if multiple groups in robots.txt are applicable to
// the same user-agent, they are merged internally into a single set of rules.
//
// For our target bots we look for an *exact* normalised agent match.
// For the wildcard we look for the literal "*".
function getRulesForAgent(groups, agentName) {
  const isWildcard = agentName === "*";
  const norm       = isWildcard ? null : agentName.toLowerCase();
  const merged     = [];

  for (const group of groups) {
    const hit = group.agents.some(a =>
      isWildcard
        ? a.trim() === "*"              // literal wildcard — do NOT normalise
        : normalizeAgent(a) === norm    // version/wildcard stripped
    );
    if (hit) merged.push(...group.rules);
  }

  return merged; // may be empty
}

// ── Main bot-priority analysis ────────────────────────────────
// Returns { botName, groupSource, winningRule, status }
//   botName     — which bot's rules were applied ("googlebot", "*", or null)
//   groupSource — "explicit" | "wildcard" | "none"
//   winningRule — { type, path, length } or null
//   status      — "allowed" | "disallowed"
function analyzeForBots(groups, urlPath) {
  // 1. Try each target bot in priority order
  for (const bot of TARGET_BOTS) {
    const rules = getRulesForAgent(groups, bot);
    if (!rules.length) continue;            // no group for this bot

    const rule = bestRule(rules, urlPath);
    return {
      botName:     bot,
      groupSource: "explicit",
      winningRule: rule,
      status:      rule?.type === "disallow" ? "disallowed" : "allowed",
    };
  }

  // 2. Fall back to wildcard group
  const wcRules = getRulesForAgent(groups, "*");
  if (wcRules.length) {
    const rule = bestRule(wcRules, urlPath);
    return {
      botName:     "*",
      groupSource: "wildcard",
      winningRule: rule,
      status:      rule?.type === "disallow" ? "disallowed" : "allowed",
    };
  }

  // 3. No usable group at all
  return { botName: null, groupSource: "none", winningRule: null, status: "allowed" };
}

function computeStatus(botAnalysis, hasRobots) {
  if (!hasRobots) return "open";
  return botAnalysis.status; // "allowed" or "disallowed"
}

// ── Icon Drawing ───────────────────────────────────────────────
const SZ = 32;
const CX = SZ / 2, CY = SZ / 2, R = SZ / 2 - 1;

function drawScan(frame) {
  const canvas = new OffscreenCanvas(SZ, SZ);
  const ctx    = canvas.getContext("2d");

  ctx.beginPath(); ctx.arc(CX, CY, R, 0, Math.PI * 2);
  ctx.fillStyle = "#080b12"; ctx.fill();

  [0.33, 0.66, 1].forEach(f => {
    ctx.beginPath(); ctx.arc(CX, CY, (R - 2) * f, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(56,68,110,0.55)"; ctx.lineWidth = 0.7; ctx.stroke();
  });

  ctx.strokeStyle = "rgba(56,68,110,0.35)"; ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.moveTo(CX, 2); ctx.lineTo(CX, SZ-2);
  ctx.moveTo(2, CY); ctx.lineTo(SZ-2, CY); ctx.stroke();

  const sweep = ((frame % 36) / 36) * Math.PI * 2 - Math.PI / 2;
  const TRAIL = 22;
  for (let i = TRAIL; i >= 0; i--) {
    const a     = sweep - (i / TRAIL) * (Math.PI * 0.75);
    const alpha = Math.pow(1 - i / TRAIL, 1.5) * 0.75;
    ctx.beginPath(); ctx.moveTo(CX, CY);
    ctx.arc(CX, CY, R - 2, a - 0.22, a); ctx.closePath();
    ctx.fillStyle = `rgba(96,165,250,${alpha})`; ctx.fill();
  }

  ctx.beginPath(); ctx.moveTo(CX, CY);
  ctx.arc(CX, CY, R - 2, sweep - 0.08, sweep); ctx.closePath();
  ctx.fillStyle = "rgba(186,224,255,0.9)"; ctx.fill();

  const ex = CX + (R - 2) * Math.cos(sweep), ey = CY + (R - 2) * Math.sin(sweep);
  const lg = ctx.createLinearGradient(CX, CY, ex, ey);
  lg.addColorStop(0, "rgba(186,224,255,0)"); lg.addColorStop(1, "rgba(186,224,255,0.95)");
  ctx.beginPath(); ctx.moveTo(CX, CY); ctx.lineTo(ex, ey);
  ctx.strokeStyle = lg; ctx.lineWidth = 1.2; ctx.stroke();

  [[0.6,-0.9],[-0.7,0.5],[0.3,0.8]].forEach(([bx,by], i) => {
    const p = Math.sin(frame * 0.18 + i * 2.1) * 0.5 + 0.5;
    ctx.beginPath(); ctx.arc(CX + bx*(R-5), CY + by*(R-5), 1.4, 0, Math.PI*2);
    ctx.fillStyle = `rgba(96,165,250,${p*0.9})`; ctx.fill();
  });

  ctx.beginPath(); ctx.arc(CX, CY, 2.2, 0, Math.PI * 2);
  const cg = ctx.createRadialGradient(CX, CY, 0, CX, CY, 2.2);
  cg.addColorStop(0, "#fff"); cg.addColorStop(1, "#60a5fa");
  ctx.fillStyle = cg; ctx.fill();

  ctx.beginPath(); ctx.arc(CX, CY, R, 0, Math.PI * 2);
  ctx.strokeStyle = "#1e2840"; ctx.lineWidth = 1.2; ctx.stroke();

  return ctx.getImageData(0, 0, SZ, SZ);
}

const THEMES = {
  allowed:    { a:"#4ade80", b:"#166534", glow:"rgba(74,222,128,0.55)"  },
  open:       { a:"#34d399", b:"#065f46", glow:"rgba(52,211,153,0.55)"  },
  disallowed: { a:"#f87171", b:"#7f1d1d", glow:"rgba(248,113,113,0.55)" },
  partial:    { a:"#fbbf24", b:"#78350f", glow:"rgba(251,191,36,0.55)"  },
  error:      { a:"#94a3b8", b:"#1e293b", glow:"rgba(148,163,184,0.35)" },
};

function drawResult(status) {
  const canvas = new OffscreenCanvas(SZ, SZ);
  const ctx    = canvas.getContext("2d");
  const theme  = THEMES[status] || THEMES.error;

  ctx.shadowBlur = 10; ctx.shadowColor = theme.glow;
  const gr = ctx.createRadialGradient(CX-4, CY-5, 1, CX, CY, R+1);
  gr.addColorStop(0, theme.a); gr.addColorStop(0.7, theme.b);
  ctx.beginPath(); ctx.arc(CX, CY, R, 0, Math.PI * 2);
  ctx.fillStyle = gr; ctx.fill(); ctx.shadowBlur = 0;

  const hl = ctx.createRadialGradient(CX-3, CY-4, 0, CX-3, CY-4, R*0.65);
  hl.addColorStop(0, "rgba(255,255,255,0.25)"); hl.addColorStop(1, "rgba(255,255,255,0)");
  ctx.beginPath(); ctx.arc(CX, CY, R, 0, Math.PI * 2);
  ctx.fillStyle = hl; ctx.fill();

  ctx.beginPath(); ctx.arc(CX, CY, R, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.15)"; ctx.lineWidth = 1; ctx.stroke();

  ctx.strokeStyle = "rgba(255,255,255,0.95)"; ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.lineJoin = "round";

  if (status === "allowed" || status === "open") {
    ctx.beginPath(); ctx.moveTo(9,16.5); ctx.lineTo(13.5,21.5); ctx.lineTo(23,10.5); ctx.stroke();
  } else if (status === "disallowed") {
    ctx.beginPath();
    ctx.moveTo(10.5,10.5); ctx.lineTo(21.5,21.5);
    ctx.moveTo(21.5,10.5); ctx.lineTo(10.5,21.5); ctx.stroke();
  } else if (status === "partial") {
    ctx.beginPath(); ctx.moveTo(CX, 9); ctx.lineTo(CX, 19); ctx.stroke();
    ctx.beginPath(); ctx.arc(CX, 23, 1.8, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.font = "bold 14px system-ui,sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("?", CX+0.5, CY+1);
  }

  return ctx.getImageData(0, 0, SZ, SZ);
}

// Pre-bake result icons
const iconCache = {};
function getIcon(status) {
  if (!iconCache[status]) iconCache[status] = drawResult(status);
  return iconCache[status];
}

// ── Animation ──────────────────────────────────────────────────
function startScan(tabId) {
  stopScan(tabId);
  let frame = 0;
  const iv = setInterval(() => {
    frame++;
    browser.pageAction.setIcon({ tabId, imageData: { 32: drawScan(frame) } })
      .catch(() => stopScan(tabId));
  }, 55);
  animations.set(tabId, iv);
}

function stopScan(tabId) {
  if (animations.has(tabId)) { clearInterval(animations.get(tabId)); animations.delete(tabId); }
}

function setResult(tabId, status) {
  stopScan(tabId);
  browser.pageAction.setIcon({ tabId, imageData: { 32: getIcon(status) } }).catch(() => {});
}

// ── Analysis ───────────────────────────────────────────────────
async function analyzeTab(tabId, url) {
  if (!url || !url.startsWith("http")) { browser.pageAction.hide(tabId); tabResults.delete(tabId); return; }
  let origin, hostname, pathname;
  try { const u = new URL(url); origin = u.origin; hostname = u.hostname; pathname = u.pathname + (u.search||""); }
  catch { return; }

  browser.pageAction.show(tabId);
  startScan(tabId);

  let entry = domainCache.get(hostname);
  const fresh = entry && (Date.now() - entry.fetchedAt < CACHE_TTL);

  if (!fresh) {
    try {
      const resp = await fetch(`${origin}/robots.txt`, { cache: "no-store" });
      const text = resp.ok ? await resp.text() : "";
      entry = { text, groups: parseRobotsTxt(text), fetchedAt: Date.now(), ok: resp.ok };
      domainCache.set(hostname, entry);
    } catch (err) {
      tabResults.set(tabId, { hostname, pathname, status: "error", error: err.message, fromCache: false });
      setResult(tabId, "error");
      browser.pageAction.setTitle({ tabId, title: "Robots Radar — Fetch error" });
      return;
    }
  }

  const { text, groups, ok } = entry;
  const hasRobots   = ok && text.trim().length > 0;
  const botAnalysis = analyzeForBots(hasRobots ? groups : [], pathname);
  const status      = computeStatus(botAnalysis, hasRobots);

  let totalAllow = 0, totalDisallow = 0;
  const agentSet = new Set();
  groups.forEach(g => { g.agents.forEach(a => agentSet.add(a)); g.rules.forEach(r => r.type === "allow" ? totalAllow++ : totalDisallow++); });

  tabResults.set(tabId, {
    hostname, pathname, status, botAnalysis, text, groups, hasRobots,
    fromCache: fresh,
    fetchedAt: entry.fetchedAt,
    stats: { allow: totalAllow, disallow: totalDisallow, agents: agentSet.size },
  });

  setResult(tabId, status);

  const label = { allowed:"✅ Allowed", open:"✅ Open (no robots.txt)", disallowed:"🚫 Disallowed" }[status] || "❓";
  const botLabel = botAnalysis.botName ? ` [${botAnalysis.botName}]` : "";
  browser.pageAction.setTitle({ tabId, title: `Robots Radar — ${label}${botLabel}\n${hostname}${pathname}` });
}

// ── Listeners ──────────────────────────────────────────────────
browser.webNavigation.onCommitted.addListener(({ tabId, url, frameId }) => {
  if (frameId !== 0) return;
  if (url?.startsWith("http")) { browser.pageAction.show(tabId); startScan(tabId); }
});

browser.webNavigation.onCompleted.addListener(({ tabId, url, frameId }) => {
  if (frameId !== 0) return;
  analyzeTab(tabId, url);
});

browser.tabs.onActivated.addListener(({ tabId }) => {
  const result = tabResults.get(tabId);
  if (result) { browser.pageAction.show(tabId); setResult(tabId, result.status); }
  else browser.tabs.get(tabId).then(tab => { if (tab.url?.startsWith("http")) analyzeTab(tabId, tab.url); }).catch(()=>{});
});

browser.tabs.onRemoved.addListener(tabId => { stopScan(tabId); tabResults.delete(tabId); });

// ── Message handler ────────────────────────────────────────────
browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === "GET_ANALYSIS") {
    return browser.tabs.query({ active: true, currentWindow: true })
      .then(tabs => tabResults.get(tabs[0]?.id) || null);
  }
  if (msg.type === "CLEAR_CACHE") {
    try { domainCache.delete(new URL(msg.url).hostname); _regexCache.clear(); } catch {}
    return browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
      const tab = tabs[0];
      if (tab) { tabResults.delete(tab.id); analyzeTab(tab.id, tab.url); }
      return true;
    });
  }
});

// Warm icon cache
["allowed","open","disallowed","partial","error"].forEach(getIcon);
