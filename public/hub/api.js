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

  async getScattergrams() {
    const res = await fetch("/api/workspace/scattergrams", { credentials: "same-origin" });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.success === false) throw new Error((j && j.error) || "Failed to load scattergrams");
    return j.data;
  },

  async deleteScattergrams() {
    const res = await fetch("/api/workspace/scattergrams", { method: "DELETE", credentials: "same-origin" });
    if (!res.ok) throw new Error("Delete failed");
  },

  exportUrl(format) {
    return "/api/workspace/export?format=" + encodeURIComponent(format);
  },
};
