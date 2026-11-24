// Runs on the Scrim website. Lets the page talk to the extension through
// window.postMessage (no extension ID needed), and marks the page so Scrim
// can tell the extension is installed.
(function () {
  const ALLOWED = new Set(["pair", "unpair", "status", "sync"]);
  document.documentElement.dataset.scrimExtension = chrome.runtime.getManifest().version;

  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const msg = event.data;
    if (!msg || msg.source !== "scrim-web" || !ALLOWED.has(msg.type)) return;
    let reply;
    let stale = false;
    try {
      reply = await chrome.runtime.sendMessage({ ...(msg.payload ?? {}), type: msg.type, scrimOrigin: location.origin });
    } catch (e) {
      const message = String(e?.message ?? e);
      // The extension was reloaded or updated since this page loaded.
      stale = /context invalidated|receiving end does not exist/i.test(message);
      reply = {
        ok: false,
        error: /context invalidated|receiving end does not exist/i.test(message)
          ? "The Scrim extension was updated. Reload this page to reconnect."
          : message,
      };
    }
    // This copy is left over from before the extension was reloaded; it puts a
    // fresh copy into open Scrim tabs, which answers properly. The page takes
    // the first answer, so let that one go first (this error is only for when
    // there's no fresh copy).
    if (stale) await new Promise((r) => setTimeout(r, 1500));
    window.postMessage({ source: "scrim-ext", id: msg.id, reply }, location.origin);
  });
})();
