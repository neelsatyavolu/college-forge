// User-facing AI progress copy (mirrors lib/chat-status.ts for Babel hub scripts).
(function () {
  var ROUND_MESSAGES = [
    "Thinking…",
    "Looking things up…",
    "Putting it together…",
    "Still working…",
    "Almost there…",
    "Finishing touches…",
    "Double-checking…",
    "Wrapping up…",
    "One more step…",
    "Nearly done…",
  ];

  function friendlyRoundMessage(round) {
    if (!round || round <= 1) return ROUND_MESSAGES[0];
    var idx = Math.min(round - 1, ROUND_MESSAGES.length - 1);
    return ROUND_MESSAGES[idx];
  }

  function friendlyToolMessage(name, path) {
    var detail = path && path.length < 60 ? path : path ? path.slice(0, 48) + "…" : "";
    switch (name) {
      case "web_search":
        return detail ? "Searching the web for “" + detail + "”…" : "Searching the web…";
      case "web_fetch":
        return detail ? "Reading page " + detail + "…" : "Reading a web page…";
      case "read_upload":
      case "read_file":
        return detail ? "Reading " + detail + "…" : "Reading your file…";
      case "set_applicant_snapshot":
        return "Updating your overview snapshot…";
      case "set_profile_identity":
        return "Saving your profile…";
      case "set_testing":
        return "Saving test scores…";
      case "set_coursework":
        return "Saving coursework…";
      case "set_activities":
        return "Saving activities…";
      case "set_honors":
        return "Saving awards & honors…";
      case "upsert_college":
        return detail ? "Updating " + detail + "…" : "Updating your school list…";
      case "remove_college":
        return "Updating your school list…";
      case "set_early_decision":
        return "Setting early-decision school…";
      case "set_application_rounds":
        return "Balancing your application rounds…";
      case "set_critical_dates":
        return "Updating important dates…";
      case "set_essays":
        return "Updating essay prompts…";
      case "set_recommendations":
        return "Updating recommenders…";
      case "set_scholarships":
        return "Updating scholarships…";
      case "set_financial_aid":
        return "Updating financial aid…";
      case "set_application_status":
        return "Updating application status…";
      default:
        return "Updating your hub…";
    }
  }

  /** Soften any residual technical status lines from older servers. */
  function softenStatusMessage(msg) {
    if (!msg || typeof msg !== "string") return "Working…";
    var m = msg.trim();
    if (/^continuing/i.test(m) && /round/i.test(m)) {
      var n = parseInt((m.match(/round\s*(\d+)/i) || [])[1] || "2", 10);
      return friendlyRoundMessage(n);
    }
    if (/^thinking\s*:/i.test(m)) return "Thinking it through…";
    if (/^writing answer/i.test(m)) return "Writing a reply…";
    if (/updating (your )?hub:\s*/i.test(m)) {
      var rest = m.replace(/updating (your )?hub:\s*/i, "");
      var name = rest.split(/[\s(]/)[0];
      var pathMatch = rest.match(/\(([^)]+)\)/);
      return friendlyToolMessage(name, pathMatch ? pathMatch[1] : "");
    }
    if (/tool-read budget|tool round/i.test(m)) return "That took a lot of steps…";
    return m;
  }

  window.cfChatStatus = {
    friendlyRoundMessage: friendlyRoundMessage,
    friendlyToolMessage: friendlyToolMessage,
    softenStatusMessage: softenStatusMessage,
  };
})();
