// Shared fetch helpers for the hub (Babel-loaded as a plain script).
window.cfApi = {
  async getWorkspace() {
    const res = await fetch("/api/workspace", { credentials: "same-origin" });
    if (!res.ok) throw new Error("Failed to load workspace");
    return res.json();
  },

  async patch(patch) {
    const res = await fetch("/api/workspace", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.success === false) {
      throw new Error((j && j.error) || "Save failed");
    }
    return j.data;
  },

  async postAction(action, body) {
    const res = await fetch("/api/workspace", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...body }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.success === false) {
      throw new Error((j && j.error) || "Request failed");
    }
    return j;
  },

  async me() {
    const res = await fetch("/api/me", { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) throw new Error("Couldn't reach Forge");
    return res.json();
  },

  /** Applications tracker: GET the list, or POST one action ({ action, ... }). */
  async applications(body) {
    const res = await fetch("/api/applications", body ? {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    } : { credentials: "same-origin", cache: "no-store" });
    const j = await res.json().catch(() => ({}));
    if (res.status === 401) { window.location.reload(); throw new Error("Please sign in again."); }
    if (!res.ok || j.success === false) throw new Error((j && j.error) || "That didn't save. Try again.");
    return j;
  },

  async catalog() {
    if (!this._catalog) {
      this._catalog = fetch("/api/applications/catalog").then((r) => {
        if (!r.ok) throw new Error("Couldn't load the school list");
        return r.json();
      }).catch((e) => { this._catalog = null; throw e; });
    }
    return this._catalog;
  },

  async connections(revokeId) {
    const res = await fetch("/api/connections", revokeId ? {
      method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: revokeId }),
    } : { credentials: "same-origin", cache: "no-store" });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.success === false) throw new Error("Couldn't load connected assistants.");
    return j.data || [];
  },

  async signOut() {
    await fetch("/api/xanom/logout", { method: "POST", credentials: "same-origin" });
  },

  exportUrl(format) {
    return "/api/workspace/export?format=" + encodeURIComponent(format);
  },
};
