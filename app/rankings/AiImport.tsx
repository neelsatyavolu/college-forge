import { useRef, useState } from "react";
import type { CareerAi } from "@/lib/career-ai";

type Props = { ai: CareerAi | null; onChange: (ai: CareerAi | null) => void };

/** Load, replace or remove the signed-in student's own judged ranking. It is saved privately to their account. */
export default function AiImport({ ai, onChange }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const send = async (method: "PUT" | "DELETE", body?: string) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/rankings/me/ai", {
        method,
        credentials: "same-origin",
        headers: body ? { "content-type": "application/json" } : undefined,
        body,
      });
      const out = (await res.json().catch(() => ({}))) as { ai?: CareerAi; error?: string };
      if (!res.ok) throw new Error(out.error || "Forge couldn't do that just now. Try again.");
      onChange(method === "PUT" ? out.ai ?? null : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Forge couldn't do that just now. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const pick = async (file: File | undefined) => {
    if (input.current) input.current.value = "";
    if (file) await send("PUT", await file.text());
  };

  return (
    <div className="rk-settings__group">
      <h4>Your own judged list</h4>
      <p>
        {ai
          ? `Loaded: ${ai.list.length} schools${ai.made ? `, made ${ai.made}` : ""}. It shows as the AI My Path tab.`
          : "Load a JSON file with your own ranking and a reason for each school. It shows as an AI My Path tab."}{" "}
        Only you can see it. It is not shared, exported or read by Forge's assistant.
      </p>
      <input ref={input} type="file" accept="application/json,.json" hidden onChange={(e) => pick(e.target.files?.[0])} />
      <div className="rk-pills">
        <button type="button" className="rk-pill" disabled={busy} onClick={() => input.current?.click()}>
          {ai ? "Replace the list" : "Load a list"}
        </button>
        {ai && (
          <button type="button" className="rk-link-btn" disabled={busy} onClick={() => send("DELETE")}>
            Remove
          </button>
        )}
      </div>
      {error && <p className="rk-ai__error" role="alert">{error}</p>}
    </div>
  );
}
