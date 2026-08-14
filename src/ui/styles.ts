/**
 * The widget stylesheet.
 *
 * It lives inside the shadow root, so the host page's CSS cannot reach in and
 * break it, and nothing here leaks out. Everything a page might reasonably want
 * to restyle is exposed as a custom property instead: custom properties *do*
 * cross the shadow boundary, which makes them the whole theming surface.
 */
export const WIDGET_STYLES = `
:host {
  --payroll-font: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --payroll-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  --payroll-fg: #16202c;
  --payroll-muted: #5a6b7d;
  --payroll-bg: #ffffff;
  --payroll-surface: #f4f7fa;
  --payroll-border: #d8e0e8;
  --payroll-accent: #0f6fbf;
  --payroll-accent-contrast: #ffffff;
  --payroll-radius: 10px;
  --payroll-gap: 1rem;
  --payroll-font-size: 15px;
  --payroll-shadow: 0 1px 2px rgba(16, 32, 48, 0.06);

  display: block;
  box-sizing: border-box;
  font-family: var(--payroll-font);
  font-size: var(--payroll-font-size);
  line-height: 1.5;
  color: var(--payroll-fg);
  background: var(--payroll-bg);
  border: 1px solid var(--payroll-border);
  border-radius: var(--payroll-radius);
  padding: var(--payroll-gap);
  container-type: inline-size;
}

@media (prefers-color-scheme: dark) {
  :host(:not([theme="light"])) {
    --payroll-fg: #e8eef4;
    --payroll-muted: #9fb0c0;
    --payroll-bg: #131a22;
    --payroll-surface: #1b242e;
    --payroll-border: #2c3947;
    --payroll-accent: #5aa9ee;
    --payroll-accent-contrast: #0a1119;
    --payroll-shadow: none;
  }
}

:host([theme="dark"]) {
  --payroll-fg: #e8eef4;
  --payroll-muted: #9fb0c0;
  --payroll-bg: #131a22;
  --payroll-surface: #1b242e;
  --payroll-border: #2c3947;
  --payroll-accent: #5aa9ee;
  --payroll-accent-contrast: #0a1119;
  --payroll-shadow: none;
}

:host([hidden]) { display: none; }

*, *::before, *::after { box-sizing: inherit; }

.head { margin-bottom: var(--payroll-gap); }
.title { margin: 0; font-size: 1.05rem; font-weight: 650; letter-spacing: -0.01em; }
.tagline { margin: 0.15rem 0 0; color: var(--payroll-muted); font-size: 0.87em; }

form { display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); }

.field { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; }
.field--wide { grid-column: 1 / -1; }

label { font-weight: 550; font-size: 0.85em; }

input[type="text"], input[type="number"], input[type="date"], select {
  font: inherit;
  color: inherit;
  width: 100%;
  padding: 0.45rem 0.55rem;
  background: var(--payroll-bg);
  border: 1px solid var(--payroll-border);
  border-radius: calc(var(--payroll-radius) - 4px);
  min-height: 2.25rem;
}

input:focus-visible, select:focus-visible, button:focus-visible, summary:focus-visible {
  outline: 2px solid var(--payroll-accent);
  outline-offset: 2px;
}

.check { flex-direction: row; align-items: flex-start; gap: 0.5rem; }
.check input { margin-top: 0.2rem; width: 1rem; height: 1rem; accent-color: var(--payroll-accent); }
.check label { font-weight: 450; }

.hint { color: var(--payroll-muted); font-size: 0.78em; }

.actions { grid-column: 1 / -1; display: flex; gap: 0.5rem; flex-wrap: wrap; }

button {
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  padding: 0.5rem 1rem;
  border-radius: calc(var(--payroll-radius) - 4px);
  border: 1px solid var(--payroll-accent);
  background: var(--payroll-accent);
  color: var(--payroll-accent-contrast);
  min-height: 2.4rem;
}

button.secondary { background: transparent; color: var(--payroll-accent); }

.result { margin-top: var(--payroll-gap); }

.headline {
  background: var(--payroll-surface);
  border: 1px solid var(--payroll-border);
  border-radius: calc(var(--payroll-radius) - 2px);
  padding: 0.7rem 0.85rem;
  box-shadow: var(--payroll-shadow);
}
.headline-label { color: var(--payroll-muted); font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.06em; }
.headline-value { font-size: 1.6rem; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }

table { width: 100%; border-collapse: collapse; margin-top: 0.75rem; font-variant-numeric: tabular-nums; }
caption { text-align: left; color: var(--payroll-muted); font-size: 0.8em; padding-bottom: 0.3rem; }
th, td { text-align: left; padding: 0.35rem 0.5rem; border-bottom: 1px solid var(--payroll-border); }
td:last-child, th:last-child { text-align: right; white-space: nowrap; }
tr.total td { font-weight: 700; }
tr:last-child td { border-bottom: none; }

.scroll { overflow-x: auto; }

.note {
  margin-top: 0.7rem;
  padding: 0.55rem 0.7rem;
  background: var(--payroll-surface);
  border-left: 3px solid var(--payroll-accent);
  border-radius: 0 calc(var(--payroll-radius) - 4px) calc(var(--payroll-radius) - 4px) 0;
  font-size: 0.85em;
}

.error { border-left-color: #c0392b; }

details { margin-top: 0.7rem; border-top: 1px solid var(--payroll-border); padding-top: 0.5rem; }
summary { cursor: pointer; font-weight: 600; font-size: 0.88em; }
details ol { margin: 0.5rem 0 0; padding-left: 1.2rem; display: grid; gap: 0.45rem; }
.step-label { font-weight: 550; }
.step-formula { font-family: var(--payroll-mono); font-size: 0.82em; color: var(--payroll-muted); word-break: break-word; }
.step-amount { font-variant-numeric: tabular-nums; }
.step-citation { font-size: 0.78em; color: var(--payroll-muted); }

.citations { margin: 0.6rem 0 0; padding-left: 1.1rem; font-size: 0.78em; color: var(--payroll-muted); }

.explanation { margin-top: 0.6rem; font-size: 0.85em; color: var(--payroll-muted); }

.events { list-style: none; margin: 0.75rem 0 0; padding: 0; display: grid; gap: 0.4rem; }
.event {
  display: grid;
  grid-template-columns: 6.5rem 1fr;
  gap: 0.6rem;
  padding: 0.5rem 0.6rem;
  background: var(--payroll-surface);
  border-radius: calc(var(--payroll-radius) - 4px);
}
.event-date { font-variant-numeric: tabular-nums; font-weight: 600; font-size: 0.85em; }
.event-title { font-weight: 550; font-size: 0.9em; }
.event-meta { color: var(--payroll-muted); font-size: 0.8em; }

@container (max-width: 380px) {
  .event { grid-template-columns: 1fr; gap: 0.15rem; }
  .headline-value { font-size: 1.35rem; }
}

.visually-hidden {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

.footer { margin-top: 0.8rem; font-size: 0.75em; color: var(--payroll-muted); }
.footer a { color: inherit; }
`;
