/* @ds-bundle: {"format":4,"namespace":"CollegeForgeDesignSystem_e95e63","components":[{"name":"CollegeCard","sourcePath":"components/college/CollegeCard.jsx"},{"name":"Badge","sourcePath":"components/data-display/Badge.jsx"},{"name":"Card","sourcePath":"components/data-display/Card.jsx"},{"name":"SectionLabel","sourcePath":"components/data-display/SectionLabel.jsx"},{"name":"StatCard","sourcePath":"components/data-display/StatCard.jsx"},{"name":"Tile","sourcePath":"components/data-display/Tile.jsx"},{"name":"VerdictBadge","sourcePath":"components/data-display/VerdictBadge.jsx"},{"name":"Button","sourcePath":"components/forms/Button.jsx"},{"name":"Chip","sourcePath":"components/forms/Chip.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"TopBar","sourcePath":"components/navigation/TopBar.jsx"}],"sourceHashes":{"components/college/CollegeCard.jsx":"6409abbc113e","components/data-display/Badge.jsx":"4197fa949e0f","components/data-display/Card.jsx":"b2b3ac20b154","components/data-display/SectionLabel.jsx":"7b79831de6b5","components/data-display/StatCard.jsx":"5307105e1e76","components/data-display/Tile.jsx":"e38d9f2d3864","components/data-display/VerdictBadge.jsx":"ec0b1cfbac2c","components/forms/Button.jsx":"2c9b57e4a55b","components/forms/Chip.jsx":"3e1946101d67","components/forms/Input.jsx":"1a53d7417ee3","components/navigation/TopBar.jsx":"9d917f60db68","ui_kits/hub/AiChat.jsx":"def3e67c384b","ui_kits/hub/App.jsx":"f1d0f891dbf6","ui_kits/hub/Essays.jsx":"17994019986b","ui_kits/hub/Explore.jsx":"c341c20c5a79","ui_kits/hub/Overview.jsx":"b28b9532d120","ui_kits/hub/Planner.jsx":"ea3e969faadd","ui_kits/hub/Profile.jsx":"beb28055b468","ui_kits/hub/Shortlist.jsx":"dbb89e6f7fe8","ui_kits/hub/Timeline.jsx":"3b4f8d80bd00","ui_kits/hub/data.js":"4d572227286c"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.CollegeForgeDesignSystem_e95e63 = window.CollegeForgeDesignSystem_e95e63 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/college/CollegeCard.jsx
try { (() => {
const {
  useState
} = React;
const TAG_TONE = {
  strong: {
    background: "color-mix(in srgb, var(--accent-teal) 15%, transparent)",
    color: "var(--ink)",
    boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--accent-teal) 40%, transparent)"
  },
  close: {
    background: "color-mix(in srgb, var(--accent-amber) 20%, transparent)",
    color: "var(--ink)",
    boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--accent-amber) 40%, transparent)"
  },
  reach: {
    background: "color-mix(in srgb, var(--error) 10%, transparent)",
    color: "var(--error)",
    boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--error) 30%, transparent)"
  }
};
function initialsOf(name) {
  // Patched: the original stripped hyphens and took the first two words, so
  // "University of California-Berkeley" became "UO". Split on any non-letter
  // and skip connector words -> "UC".
  var STOP = { of: 1, the: 1, at: 1, and: 1, "for": 1, "in": 1, a: 1 };
  var all = name.replace(/[^A-Za-z]+/g, " ").split(/\s+/).filter(Boolean);
  var words = all.filter(function (w) { return !STOP[w.toLowerCase()]; });
  if (!words.length) words = all;
  return words.slice(0, 2).map(function (w) { return w[0]; }).join("").toUpperCase();
}

/**
 * College Forge college card — the ranked school row used across search and
 * shortlists: photo thumbnail (initials fallback), name, location, fit tags,
 * rank pill, favorite star, and a mono stat line.
 */
function CollegeCard({
  name,
  location,
  rank,
  admit,
  satRange,
  gpa,
  photo,
  favorite = false,
  selected = false,
  tags = [],
  onToggleFavorite,
  onSelect,
  style = {}
}) {
  const [hover, setHover] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const borderColor = selected ? "var(--coral)" : hover ? "color-mix(in srgb, var(--coral) 40%, transparent)" : "var(--hairline)";
  return /*#__PURE__*/React.createElement("div", {
    onClick: onSelect,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: "flex",
      gap: 16,
      borderRadius: "var(--radius-lg)",
      border: `1px solid ${borderColor}`,
      background: "var(--canvas)",
      padding: 16,
      cursor: onSelect ? "pointer" : "default",
      boxShadow: selected ? "inset 0 0 0 1px color-mix(in srgb, var(--coral) 30%, transparent)" : hover ? "var(--shadow-sm)" : "none",
      transition: "border-color 140ms ease, box-shadow 140ms ease",
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 96,
      width: 96,
      flexShrink: 0,
      overflow: "hidden",
      borderRadius: "var(--radius-md)",
      background: "var(--hairline)"
    }
  }, photo && !imgFailed ? /*#__PURE__*/React.createElement("img", {
    src: photo,
    alt: "",
    onError: () => setImgFailed(true),
    style: {
      height: "100%",
      width: "100%",
      objectFit: "cover",
      display: "block"
    }
  }) : /*#__PURE__*/React.createElement("div", {
    style: {
      height: "100%",
      width: "100%",
      display: "grid",
      placeItems: "center",
      background: "color-mix(in srgb, var(--coral) 10%, transparent)",
      color: "var(--coral)",
      fontFamily: "var(--font-display)",
      fontWeight: 500,
      fontSize: 22
    }
  }, initialsOf(name))), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0,
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      fontFamily: "var(--font-display)",
      fontWeight: 500,
      fontSize: 22,
      lineHeight: 1.25,
      color: "var(--ink)",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, name), location ? /*#__PURE__*/React.createElement("p", {
    style: {
      margin: "2px 0 0",
      fontSize: 14,
      color: "var(--muted)"
    }
  }, "\uD83D\uDCCD ", location) : null), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      flexShrink: 0
    }
  }, typeof rank === "number" && rank > 0 ? /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      fontWeight: 600,
      textTransform: "uppercase",
      letterSpacing: "1px",
      padding: "2px 8px",
      borderRadius: "var(--radius-pill)",
      background: "color-mix(in srgb, var(--coral) 14%, transparent)",
      color: "var(--coral)",
      boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--coral) 35%, transparent)"
    },
    title: "U.S. News National Universities rank"
  }, "#", rank) : null, onToggleFavorite ? /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: e => {
      e.stopPropagation();
      onToggleFavorite();
    },
    "aria-pressed": favorite,
    "aria-label": favorite ? "Remove from favorites" : "Add to favorites",
    style: {
      border: "none",
      background: "none",
      cursor: "pointer",
      fontSize: 16,
      lineHeight: 1,
      color: "var(--accent-amber)",
      padding: 0
    }
  }, favorite ? "★" : "☆") : null)), tags.length > 0 ? /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8,
      display: "flex",
      flexWrap: "wrap",
      gap: 6
    }
  }, tags.map((t, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      fontSize: 11,
      fontWeight: 500,
      padding: "2px 8px",
      borderRadius: "var(--radius-pill)",
      ...(TAG_TONE[t.tone] ?? TAG_TONE.strong)
    }
  }, t.label))) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8,
      fontFamily: "var(--font-mono)",
      fontSize: 12,
      color: "var(--muted)"
    }
  }, "Admit ", admit ?? "—", " \xB7 SAT ", satRange ?? "—", " \xB7 GPA ", gpa ?? "—")));
}
Object.assign(__ds_scope, { CollegeCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/college/CollegeCard.jsx", error: String((e && e.message) || e) }); }

// components/data-display/Badge.jsx
try { (() => {
const VARIANTS = {
  cream: {
    background: "var(--surface-card)",
    color: "var(--ink)"
  },
  coral: {
    background: "var(--coral)",
    color: "var(--on-primary)"
  },
  dark: {
    background: "var(--surface-dark)",
    color: "var(--on-dark)"
  },
  teal: {
    background: "var(--accent-teal)",
    color: "var(--on-primary)"
  },
  amber: {
    background: "var(--accent-amber)",
    color: "var(--ink)"
  }
};

/**
 * College Forge badge — a small pill label. Cream by default; coral/dark/teal/amber
 * for emphasis. `uppercase` for eyebrow-style tags.
 */
function Badge({
  variant = "cream",
  uppercase = false,
  children,
  style = {}
}) {
  const v = VARIANTS[variant] ?? VARIANTS.cream;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      padding: "4px 12px",
      borderRadius: "var(--radius-pill)",
      fontSize: 12,
      fontWeight: 500,
      fontFamily: "var(--font-body)",
      ...(uppercase ? {
        textTransform: "uppercase",
        letterSpacing: "1px"
      } : null),
      ...v,
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data-display/Badge.jsx", error: String((e && e.message) || e) }); }

// components/data-display/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const VARIANTS = {
  cream: {
    background: "var(--surface-card)",
    color: "var(--ink)"
  },
  dark: {
    background: "var(--surface-dark)",
    color: "var(--on-dark)"
  },
  coral: {
    background: "var(--coral)",
    color: "var(--on-primary)"
  },
  outline: {
    background: "var(--canvas)",
    color: "var(--ink)",
    border: "1px solid var(--hairline)"
  }
};

/**
 * College Forge surface card. Four fills: cream (default), dark, coral, and a
 * hairline-outlined canvas card. Rounded 12px, generous padding.
 */
function Card({
  variant = "cream",
  children,
  style = {},
  ...rest
}) {
  const v = VARIANTS[variant] ?? VARIANTS.cream;
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      borderRadius: "var(--radius-lg)",
      padding: 32,
      ...v,
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data-display/Card.jsx", error: String((e && e.message) || e) }); }

// components/data-display/SectionLabel.jsx
try { (() => {
/**
 * College Forge section label — the uppercase, letter-spaced eyebrow that
 * introduces nearly every section and stat group.
 */
function SectionLabel({
  children,
  style = {}
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      fontWeight: 500,
      textTransform: "uppercase",
      letterSpacing: "1.5px",
      color: "var(--muted)",
      fontFamily: "var(--font-body)",
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { SectionLabel });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data-display/SectionLabel.jsx", error: String((e && e.message) || e) }); }

// components/data-display/StatCard.jsx
try { (() => {
const VARIANTS = {
  cream: {
    background: "var(--surface-card)",
    color: "var(--ink)"
  },
  dark: {
    background: "var(--surface-dark)",
    color: "var(--on-dark)"
  },
  coral: {
    background: "var(--coral)",
    color: "var(--on-primary)"
  },
  outline: {
    background: "var(--canvas)",
    color: "var(--ink)",
    border: "1px solid var(--hairline)"
  }
};

/**
 * College Forge stat card — a big serif number with an uppercase label and
 * optional hint. Used across dashboards and profile snapshots.
 */
function StatCard({
  label,
  value,
  hint,
  variant = "outline",
  style = {}
}) {
  const v = VARIANTS[variant] ?? VARIANTS.outline;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      borderRadius: "var(--radius-lg)",
      padding: 24,
      ...v,
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      fontWeight: 500,
      textTransform: "uppercase",
      letterSpacing: "1.5px",
      opacity: 0.7,
      marginBottom: 8
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-display)",
      fontWeight: 500,
      fontSize: 28,
      lineHeight: 1.15,
      letterSpacing: "-0.3px"
    }
  }, value), hint ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      opacity: 0.7,
      marginTop: 8
    }
  }, hint) : null);
}
Object.assign(__ds_scope, { StatCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data-display/StatCard.jsx", error: String((e && e.message) || e) }); }

// components/data-display/Tile.jsx
try { (() => {
/**
 * College Forge data tile — a compact label/value box used in stat grids
 * (college detail panels, cost & outcomes, deadlines).
 */
function Tile({
  label,
  value,
  style = {}
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      borderRadius: "var(--radius-md)",
      border: "1px solid var(--hairline)",
      background: "var(--canvas)",
      padding: "8px 12px",
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      fontWeight: 500,
      textTransform: "uppercase",
      letterSpacing: "1px",
      color: "var(--muted)"
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 500,
      color: "var(--ink)",
      marginTop: 2
    }
  }, value));
}
Object.assign(__ds_scope, { Tile });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data-display/Tile.jsx", error: String((e && e.message) || e) }); }

// components/data-display/VerdictBadge.jsx
try { (() => {
const TONES = {
  top: {
    pill: {
      background: "color-mix(in srgb, var(--accent-teal) 15%, transparent)",
      color: "var(--ink)",
      boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--accent-teal) 50%, transparent)"
    },
    dot: "var(--accent-teal)"
  },
  good: {
    pill: {
      background: "color-mix(in srgb, var(--accent-teal) 10%, transparent)",
      color: "var(--ink)",
      boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--accent-teal) 30%, transparent)"
    },
    dot: "var(--accent-teal)"
  },
  caution: {
    pill: {
      background: "color-mix(in srgb, var(--accent-amber) 20%, transparent)",
      color: "var(--ink)",
      boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--accent-amber) 50%, transparent)"
    },
    dot: "var(--accent-amber)"
  },
  blocked: {
    pill: {
      background: "color-mix(in srgb, var(--error) 10%, transparent)",
      color: "var(--error)",
      boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--error) 30%, transparent)"
    },
    dot: "var(--error)"
  },
  neutral: {
    pill: {
      background: "var(--surface-card)",
      color: "var(--muted)"
    },
    dot: "var(--muted-soft)"
  }
};

/**
 * College Forge verdict badge — a fit indicator with a colored status dot.
 * Tones: top / good / caution / blocked / neutral.
 */
function VerdictBadge({
  tone = "good",
  children,
  style = {}
}) {
  const t = TONES[tone] ?? TONES.neutral;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "4px 10px",
      borderRadius: "var(--radius-pill)",
      fontSize: 12,
      fontWeight: 500,
      fontFamily: "var(--font-body)",
      ...t.pill,
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    "aria-hidden": true,
    style: {
      width: 6,
      height: 6,
      borderRadius: "50%",
      background: t.dot,
      flexShrink: 0
    }
  }), children);
}
Object.assign(__ds_scope, { VerdictBadge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data-display/VerdictBadge.jsx", error: String((e && e.message) || e) }); }

// components/forms/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  useState
} = React;
const SIZES = {
  sm: {
    padding: "6px 12px",
    fontSize: 13
  },
  md: {
    padding: "8px 16px",
    fontSize: 14
  },
  lg: {
    padding: "11px 22px",
    fontSize: 15
  }
};
const VARIANTS = {
  primary: {
    base: {
      background: "var(--coral)",
      color: "var(--on-primary)",
      border: "1px solid transparent"
    },
    hover: {
      background: "var(--coral-active)"
    }
  },
  secondary: {
    base: {
      background: "var(--canvas)",
      color: "var(--ink)",
      border: "1px solid var(--hairline)"
    },
    hover: {
      borderColor: "color-mix(in srgb, var(--coral) 45%, transparent)"
    }
  },
  ghost: {
    base: {
      background: "transparent",
      color: "var(--muted)",
      border: "1px solid transparent"
    },
    hover: {
      background: "var(--surface-card)",
      color: "var(--ink)"
    }
  },
  dark: {
    // Ink fill + canvas text: always inverted against the page, in both themes.
    // (on-dark would match ink in dark mode and wipe the label.)
    base: {
      background: "var(--ink)",
      color: "var(--canvas)",
      border: "1px solid transparent"
    },
    hover: {
      background: "var(--body-strong)"
    }
  },
  onColor: {
    // Outline control for use ON coral/dark surfaces. Must stay light-on-dark
    // in both themes — never use --on-primary (that flips to near-black in
    // dark mode for filled coral buttons, which made this label vanish).
    base: {
      background: "transparent",
      color: "var(--on-dark)",
      border: "1px solid color-mix(in srgb, var(--on-dark) 40%, transparent)"
    },
    hover: {
      background: "color-mix(in srgb, var(--on-dark) 15%, transparent)"
    }
  }
};

/**
 * College Forge primary action button. Coral by default; secondary/ghost/dark
 * for lower emphasis and onColor for use on coral or dark surfaces.
 */
function Button({
  variant = "primary",
  size = "md",
  arrow = false,
  disabled = false,
  children,
  style = {},
  ...rest
}) {
  const [hover, setHover] = useState(false);
  const v = VARIANTS[variant] ?? VARIANTS.primary;
  const s = SIZES[size] ?? SIZES.md;
  const styles = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontFamily: "var(--font-body)",
    fontWeight: 500,
    borderRadius: size === "lg" ? "var(--radius-md)" : "var(--radius-sm)",
    cursor: disabled ? "not-allowed" : "pointer",
    lineHeight: 1,
    whiteSpace: "nowrap",
    transition: "background 140ms ease, border-color 140ms ease, color 140ms ease",
    padding: s.padding,
    fontSize: s.fontSize,
    ...v.base,
    ...(hover && !disabled ? v.hover : null),
    ...(disabled ? {
      background: "var(--coral-disabled)",
      color: "var(--muted-soft)",
      borderColor: "transparent"
    } : null),
    ...style
  };
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    disabled: disabled,
    style: styles,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false)
  }, rest), children, arrow ? /*#__PURE__*/React.createElement("span", {
    "aria-hidden": true,
    style: {
      fontSize: "1.05em"
    }
  }, "\u2192") : null);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Button.jsx", error: String((e && e.message) || e) }); }

// components/forms/Chip.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  useState
} = React;
/**
 * College Forge filter chip — a pill toggle used in filter bars. Coral when active.
 */
function Chip({
  active = false,
  children,
  style = {},
  ...rest
}) {
  const [hover, setHover] = useState(false);
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      fontFamily: "var(--font-body)",
      fontSize: 14,
      fontWeight: 500,
      padding: "6px 14px",
      borderRadius: "var(--radius-pill)",
      cursor: "pointer",
      lineHeight: 1,
      transition: "background 140ms ease, border-color 140ms ease, color 140ms ease",
      border: `1px solid ${active ? "var(--coral)" : "var(--hairline)"}`,
      background: active ? "color-mix(in srgb, var(--coral) 10%, transparent)" : "var(--canvas)",
      color: active ? "var(--coral)" : hover ? "var(--ink)" : "var(--muted)",
      ...(hover && !active ? {
        borderColor: "color-mix(in srgb, var(--coral) 40%, transparent)"
      } : null),
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Chip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Chip.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  useState
} = React;
/**
 * College Forge text / search input. Warm cream field with a coral focus border.
 */
function Input({
  size = "md",
  invalid = false,
  style = {},
  ...rest
}) {
  const [focus, setFocus] = useState(false);
  const padding = size === "sm" ? "8px 12px" : "10px 16px";
  const fontSize = size === "sm" ? 13 : 14;
  const borderColor = invalid ? "var(--error)" : focus ? "var(--coral)" : "var(--hairline)";
  return /*#__PURE__*/React.createElement("input", _extends({
    onFocus: e => {
      setFocus(true);
      rest.onFocus && rest.onFocus(e);
    },
    onBlur: e => {
      setFocus(false);
      rest.onBlur && rest.onBlur(e);
    },
    style: {
      width: "100%",
      fontFamily: "var(--font-body)",
      fontSize,
      color: "var(--ink)",
      background: "var(--canvas)",
      border: `1px solid ${borderColor}`,
      borderRadius: "var(--radius-sm)",
      padding,
      outline: "none",
      transition: "border-color 140ms ease",
      ...style
    }
  }, rest));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/navigation/TopBar.jsx
try { (() => {
/**
 * College Forge top navigation bar — the sticky, blurred cream header with the
 * coral ✱ mark, brand wordmark, and inline nav links (active state highlighted).
 */
function TopBar({
  brand = "College Forge",
  items = [],
  right = null,
  style = {}
}) {
  return /*#__PURE__*/React.createElement("nav", {
    style: {
      height: "var(--nav-height)",
      background: "color-mix(in srgb, var(--canvas) 85%, transparent)",
      backdropFilter: "blur(8px)",
      WebkitBackdropFilter: "blur(8px)",
      borderBottom: "1px solid var(--hairline)",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      padding: "0 24px",
      fontFamily: "var(--font-body)",
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    "aria-hidden": true,
    style: {
      color: "var(--coral)",
      fontSize: 22,
      lineHeight: 1,
      flexShrink: 0
    }
  }, "\u2731"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-display)",
      fontWeight: 500,
      fontSize: 22,
      color: "var(--ink)",
      whiteSpace: "nowrap"
    }
  }, brand)), /*#__PURE__*/React.createElement("ul", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 2,
      listStyle: "none",
      margin: 0,
      padding: 0
    }
  }, items.map((it, i) => /*#__PURE__*/React.createElement("li", {
    key: i
  }, /*#__PURE__*/React.createElement("a", {
    href: it.href ?? "#",
    "aria-current": it.active ? "page" : undefined,
    style: {
      display: "block",
      padding: "8px 12px",
      borderRadius: "var(--radius-md)",
      fontSize: 13,
      fontWeight: 500,
      textDecoration: "none",
      color: it.active ? "var(--ink)" : "var(--muted)",
      background: it.active ? "var(--surface-card)" : "transparent"
    }
  }, it.label)))), right ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, right) : /*#__PURE__*/React.createElement("span", null));
}
Object.assign(__ds_scope, { TopBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/TopBar.jsx", error: String((e && e.message) || e) }); }

__ds_ns.CollegeCard = __ds_scope.CollegeCard;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.SectionLabel = __ds_scope.SectionLabel;

__ds_ns.StatCard = __ds_scope.StatCard;

__ds_ns.Tile = __ds_scope.Tile;

__ds_ns.VerdictBadge = __ds_scope.VerdictBadge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Chip = __ds_scope.Chip;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.TopBar = __ds_scope.TopBar;

})();
