const { Button: LetterButton } = window.CollegeForgeDesignSystem_e95e63;

// The letter is school HTML: it renders in a sandboxed frame with no scripts, no same-origin and nothing remote.
const LETTER_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'";
const letterDoc = (html) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${LETTER_CSP}"><style>body{font:15px/1.6 Georgia,serif;color:#141413;background:#fff;margin:24px;max-width:720px}img{max-width:100%;height:auto}</style></head><body>${html}</body></html>`;

// The sandboxed frame can't report its own height, so size it from the letter's length (it can be dragged taller).
function frameHeight(letter) {
  const blocks = (letter.html.match(/<(p|br|div|tr|li|h[1-6])\b/gi) || []).length;
  const images = (letter.html.match(/<img\b/gi) || []).length;
  const narrow = window.innerWidth < 640 ? 2 : 1;
  const est = 64 + Math.ceil((letter.text.length * narrow) / 90) * 26 + blocks * 18 + images * 72;
  return Math.max(200, Math.min(est, 680));
}

function pdfUrl(base64) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}

/** "Read your letter": loads the saved letter for a revealed decision and shows it inline. */
function DecisionLetter({ app, letterId, school }) {
  const [open, setOpen] = React.useState(false);
  const [letter, setLetter] = React.useState(null);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [blobUrl, setBlobUrl] = React.useState("");

  React.useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl); }, [blobUrl]);

  const toggle = async () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (letter) return;
    setLoading(true);
    setError("");
    try {
      const j = await window.cfApi.applications({ action: "letter", id: app.id, ...(letterId ? { letterId } : {}) });
      setLetter(j.letter);
      if (j.letter.kind === "pdf" && j.letter.pdfBase64) setBlobUrl(pdfUrl(j.letter.pdfBase64));
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };

  return (
    <div className="cf-decision__letter">
      <LetterButton size="sm" variant="secondary" onClick={toggle} aria-expanded={open}>{open ? "Hide the letter" : "Read your letter"}</LetterButton>
      {open ? (
        <div className="cf-letter">
          {loading ? <p className="cf-help">Opening the letter…</p> : null}
          {error ? <p role="alert" className="cf-help">{error}</p> : null}
          {letter && letter.kind === "html" ? <iframe className="cf-letter__frame" style={{ height: frameHeight(letter) }} sandbox="" referrerPolicy="no-referrer" title={`${school} decision letter`} srcDoc={letterDoc(letter.html)} /> : null}
          {letter && letter.kind === "pdf" && blobUrl ? (
            <>
              <object className="cf-letter__frame" data={blobUrl} type="application/pdf" aria-label={`${school} decision letter`}>
                <p className="cf-help">This browser can't show PDFs here.</p>
              </object>
              <a className="cf-link-btn" href={blobUrl} download={`${school} decision letter.pdf`}>Download the PDF</a>
            </>
          ) : null}
          {letter && letter.kind === "text" ? <div className="cf-letter__text">{letter.text}</div> : null}
          {letter ? <p className="cf-help">Saved by Forge on {new Date(letter.capturedAt).toLocaleDateString()}. Only you can open it.</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Merit awards the letter names, each one tap from the scholarships list. */
function LetterAwards({ app, letter, onAdded }) {
  const [added, setAdded] = React.useState({});
  const [error, setError] = React.useState("");
  if (!letter || !letter.awards || !letter.awards.length) return null;
  const add = async (index) => {
    setError("");
    try {
      await window.cfApi.applications({ action: "award-add", id: app.id, index, letterId: letter.id });
      setAdded((a) => ({ ...a, [index]: true }));
      // Letters & aid reads the workspace, so pick up the new scholarship.
      if (onAdded) onAdded();
    } catch (e) { setError(e.message); }
  };
  return (
    <div className="cf-awards">
      {letter.awards.map((w, i) => (
        <div key={i} className="cf-award">
          <span className="cf-award__name">{w.name}</span>
          {w.amount ? <span className="cf-award__amount">{w.amount}{w.period ? ` ${w.period}` : ""}</span> : null}
          {added[i] ? <span className="cf-help">Added to scholarships</span> : <LetterButton size="sm" variant="secondary" onClick={() => add(i)}>Add to scholarships</LetterButton>}
        </div>
      ))}
      {error ? <p role="alert" className="cf-help">{error}</p> : null}
    </div>
  );
}

window.DecisionLetter = DecisionLetter;
window.LetterAwards = LetterAwards;
