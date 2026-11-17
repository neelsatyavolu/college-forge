/**
 * The HTML shell every Forge email uses. Email clients ignore <style> blocks and most modern CSS,
 * so everything here is tables and inline styles. Ported from College Apps (worker/src/emailLayout.ts).
 */

export const C = {
  bg: "#f6f7f9",
  surface: "#ffffff",
  ink: "#1b2333",
  ink2: "#3f495c",
  muted: "#5d6577",
  line: "#e1e4ea",
  lineSoft: "#eef0f4",
  accent: "#16705e",
  workingFg: "#4f586b",
  workingBg: "#eceef2",
  waitingFg: "#2b5592",
  waitingBg: "#e4ecf8",
  holdFg: "#87570a",
  holdBg: "#fbefd6",
  doneFg: "#17703f",
} as const;

// Single quotes: this goes inside double-quoted style attributes.
const FONT = `'Schibsted Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`;

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** A filled button. Table-based so Outlook draws the background too. */
export function button(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-radius:8px;background:${C.accent}"><a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 20px;font-family:${FONT};font-size:15px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:8px">${escapeHtml(label)}</a></td></tr></table>`;
}

/** A tinted box for the one thing the email is about (a new decision, a login that stopped working). */
export function callout(title: string, body: string, tone: "waiting" | "hold"): string {
  const fg = tone === "hold" ? C.holdFg : C.waitingFg;
  const bg = tone === "hold" ? C.holdBg : C.waitingBg;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:${bg};border-radius:8px;padding:14px 16px"><div style="font-size:15px;font-weight:600;color:${fg};line-height:1.4">${escapeHtml(title)}</div><div style="font-size:14px;color:${C.ink2};line-height:1.5;padding-top:4px">${escapeHtml(body)}</div></td></tr></table>`;
}

export interface Layout {
  /** The line inbox previews show after the subject. */
  preheader: string;
  /** Raw HTML for the card's body. */
  body: string;
  /** Raw HTML for the small print under the card. */
  footer?: string;
  appUrl: string;
}

export function layout({ preheader, body, footer = "", appUrl }: Layout): string {
  const home = escapeHtml(appUrl);
  const host = escapeHtml(new URL(appUrl).host);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title></title></head>
<body style="margin:0;padding:0;background:${C.bg};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.bg}">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg}"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;font-family:${FONT};color:${C.ink}">
<tr><td style="padding:0 4px 16px"><a href="${home}" style="text-decoration:none;color:${C.ink};font-size:15px;font-weight:700"><img src="${home}/apple-icon.png" width="22" height="22" alt="" style="vertical-align:-5px;border:0;border-radius:6px;margin-right:8px">Forge</a></td></tr>
<tr><td style="background:${C.surface};border:1px solid ${C.line};border-radius:12px;padding:28px">${body}</td></tr>
<tr><td style="padding:20px 4px 0;font-size:12px;line-height:1.6;color:${C.muted}">${footer}${footer ? "<br>" : ""}Forge · <a href="${home}" style="color:${C.muted}">${host}</a></td></tr>
</table></td></tr></table></body></html>`;
}
