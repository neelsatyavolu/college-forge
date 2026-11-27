// The workspace sidebar: one list for the hub (App.jsx) and the full pages
// outside it (app/rankings/WorkspaceShell.tsx), so the two can't drift apart.
// Plain script so the hub loads it as window.cfNav and Next imports it.
(function (root) {
  // Hash-routed views inside the hub.
  var NAV = [
    { id: "applications", label: "Portals", group: "Applications", icon: "inbox" },
    { id: "progress", label: "Progress", group: "Applications", icon: "progress" },
    { id: "decisions", label: "Decisions", group: "Applications", icon: "mail" },
    { id: "board", label: "Decision board", group: "Applications", icon: "columns", needsAdmit: true },
    { id: "list", label: "Ranked list", group: "Applications", icon: "list" },
    { id: "essays", label: "Essays", group: "Materials", icon: "edit" },
    { id: "track", label: "Recs & aid", group: "Materials", icon: "folder" },
    { id: "recommendations", label: "Colleges for you", group: "Find colleges", icon: "spark" },
    { id: "explore", label: "Explore colleges", group: "Find colleges", icon: "search" },
    { id: "shortlist", label: "Your shortlist", group: "Find colleges", icon: "bookmark" },
    { id: "official", label: "Official rankings", group: "Find colleges", icon: "award" },
    { id: "profile", label: "Your profile", group: "You", icon: "user" },
    { id: "share", label: "Share & export", group: "You", icon: "share" },
    { id: "settings", label: "Settings", group: "You", icon: "settings" },
  ];
  var GROUPS = ["Applications", "Materials", "Find colleges", "You"];
  // Full pages outside the hash-routed views, listed after the views in their group.
  var PAGE_LINKS = [{ href: "/rankings", label: "Career rankings", group: "Find colleges", icon: "chart" }];
  var ICONS = {
    home: "M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9",
    inbox: "M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6Z",
    mail: "M3 6h18v12H3ZM3 7l9 6 9-6",
    progress: "M4 6h9M4 12h15M4 18h6M17 4v4M21 10v4M12 16v4",
    user: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-2a8 8 0 0 1 16 0v2",
    spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z",
    search: "M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0m-2 5 6 6",
    chart: "M4 20V10m6 10V4m6 16v-7m4 7H2",
    bookmark: "M6 3h12v18l-6-4-6 4Z",
    columns: "M3 4h7v16H3ZM14 4h7v16h-7Z",
    scatter: "M3 3v18h18M8 15h.01M11 10h.01M15 13h.01M18 7h.01M9 7h.01",
    edit: "m15 4 5 5M4 20l5-1L21 7l-5-5L4 14ZM13 21h8",
    list: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
    award: "M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM8.5 14 7 22l5-3 5 3-1.5-8",
    check: "m4 6 2 2 4-4M13 6h7M4 13l2 2 4-4M13 13h7M4 20h16",
    calendar: "M4 5h16v16H4ZM8 2v6m8-6v6M4 11h16",
    folder: "M3 6h7l2 3h9v12H3Z",
    share: "M12 16V3m-4 4 4-4 4 4M5 12H3v9h18v-9h-2",
    settings: "M3 6h18M3 12h18M3 18h18M8 3v6m8 0v6m-8 0v6",
  };

  var api = { NAV: NAV, GROUPS: GROUPS, PAGE_LINKS: PAGE_LINKS, ICONS: ICONS };
  root.cfNav = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
