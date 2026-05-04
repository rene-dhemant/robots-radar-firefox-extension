# Robots Radar (Firefox Extension)

Live robots.txt analyser. Instantly see if Googlebot, Bingbot or CCBot can
crawl the current page — animated colour-coded icon in your address bar on
every navigation. No clicking needed.

## DESCRIPTION 

<b>Robots Radar</b> analyses your site's <code>/robots.txt</code> in real time and shows a colour-coded icon directly <b>inside your address bar</b> — no toolbar button, no clicking, instant feedback on every page load.

<b>What the icon means</b>
- 🟢 <b>Green ✓</b>  — the current path is allowed for crawling
- 🔴 <b>Red ✗</b>    — the current path is disallowed
- 🟢 <b>Teal ✓</b>   — no robots.txt found, all paths open
- 📡 <b>Animated radar sweep</b> — shown while fetching (looks great)
- ⚫ <b>Grey ?</b>    — robots.txt could not be fetched

<b>Specification-compliant parsing</b>
Robots Radar implements Google's exact robots.txt specification (RFC 9309):
- Longest path specificity — more specific rules win
- Allow beats Disallow on equal path length
- Multiple groups for the same agent are merged
- Agent normalisation: <code>Googlebot/2.1</code> and <code>googlebot*</code> both match correctly
- Relaxed blank-line handling (matches Googlebot's documented behaviour)
- Correct wildcard matching: <code>*</code> and <code>$</code> anchors

<b>Bot priority order</b>
Rules are evaluated in this order, falling back to the next if no explicit group is found:
<code>Googlebot → Bingbot → CCBot → Google-Extended → * wildcard</code>

<b>Features</b>
- Animated radar sweep icon during every page scan
- Dark mode and Light mode with a one-click toggle — preference remembered
- Per-domain caching (1 hour TTL) — no redundant fetches on the same domain
- Works in private / incognito windows
- Click the address bar icon for a full breakdown:
-- Which bot group was matched (explicit vs wildcard fallback)
-- The single winning rule with type badge (Allow / Disallow)
-- Specificity bar showing how precise the match was
-- Syntax-highlighted robots.txt source viewer
- Refresh button to bust the cache and re-fetch live

<b>Who is this for?</b>
SEO professionals, web developers, site owners, and anyone curious about how search engines see their pages. Robots Radar turns robots.txt from a text file you forget to check into a live dashboard that follows you as you browse.

<b>Privacy</b>
Robots Radar only contacts the domain you are currently visiting, solely to fetch its public <code>/robots.txt</code> file. No data is collected, stored remotely, or shared with anyone. There are no analytics, no tracking, no third-party requests of any kind.

<b>Open source</b>
The full source code is available on GitHub. All code is plain, readable JavaScript — no bundlers, no minification, no obfuscation.

## CATEGORIES
- Primary:   **Privacy & Security**
- Secondary: **Web Development**

## LICENSE
MIT (recommended) — or "All Rights Reserved" if you prefer closed source


## SCREENSHOTS 

| # | Filename                  | Caption to enter on AMO                          |
|---|---------------------------|--------------------------------------------------|
| 1 | 01-allowed-dark.png       | Allowed status — Googlebot can crawl this page   |
| 2 | 02-disallowed-dark.png    | Disallowed status — path blocked by robots.txt   |
| 3 | 03-allowed-light.png      | Light mode — clean bright UI with toggle         |
| 4 | 04-addressbar-states.png  | All four address bar icon states at a glance     |
| 5 | 05-source-viewer.png      | Syntax-highlighted robots.txt source viewer      |

## NOTES  

Robots Radar is a robots.txt analyser that shows a colour-coded icon in the
Firefox address bar (page_action) on every page load.

HOW IT WORKS
- background.js fetches /robots.txt via the background script (bypasses CORS)
  and caches the result per domain for 1 hour.
- The parser implements Google's exact robots.txt spec (RFC 9309):
  longest-path wins, Allow beats Disallow on equal length, group merging,
  correct wildcard (* and $) matching, relaxed blank-line handling.
- Bot evaluation order: Googlebot → Bingbot → CCBot → Google-Extended → *.
- Results are drawn as a colour-coded OffscreenCanvas icon set via
  browser.pageAction.setIcon(). An animated radar sweep plays during fetch.

PERMISSIONS JUSTIFICATION
- activeTab    : read the current tab URL to evaluate the path
- tabs         : listen for tab switches so the icon updates when switching tabs
- webNavigation: trigger analysis on every navigation without user interaction
- <all_urls>   : fetch /robots.txt from the visited domain only

PRIVACY
No user data is collected or transmitted. The only outbound request is a GET
to the current domain's /robots.txt — a public resource. No analytics, no
remote storage, no third-party requests.

All code is plain readable JavaScript. No bundlers, no minification.

## PERMISSION WARNING USERS WILL SEE

When a user installs, Firefox shows:
> "Access your data for all websites"

This is triggered by `<all_urls>`. Your reviewer notes above explain this is
only used to fetch `/robots.txt` from the current domain.
