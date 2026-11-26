import { WEB_URL } from "./shared/env.js";
import type { DetectedMeeting, RuntimeMessage, StoredAuth } from "./shared/messages.js";

const detected = new Map<number, DetectedMeeting>();

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);

chrome.tabs.onRemoved.addListener((tabId) => detected.delete(tabId));

// Token emitido pela plataforma web (página /extensao/conectar) — só aceito da origem configurada.
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  const origin = sender.origin ?? (sender.url ? new URL(sender.url).origin : "");
  if (origin !== new URL(WEB_URL).origin) {
    sendResponse({ ok: false, error: "origem não autorizada" });
    return;
  }
  const m = msg as { type?: string; token?: unknown; expiresAt?: unknown };
  if (
    m?.type !== "sci:auth" ||
    typeof m.token !== "string" ||
    typeof m.expiresAt !== "string" ||
    m.token.length > 200
  ) {
    sendResponse({ ok: false, error: "mensagem inválida" });
    return;
  }
  const auth: StoredAuth = { token: m.token, expiresAt: m.expiresAt };
  void chrome.storage.local.set({ auth }).then(() => sendResponse({ ok: true }));
  return true;
});

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  if (contexts.length) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: "Capturar o áudio da reunião e do microfone, com consentimento, para transcrição.",
  });
}

chrome.runtime.onMessage.addListener((msg: RuntimeMessage, sender, sendResponse) => {
  if (msg.type === "sci:meeting-detected" && sender.tab?.id !== undefined) {
    detected.set(sender.tab.id, msg.meeting);
    return;
  }
  if (msg.type === "sci:get-detected") {
    sendResponse(detected.get(msg.tabId) ?? null);
    return;
  }
  if (msg.type === "sci:start-capture") {
    void (async () => {
      try {
        const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: msg.tabId });
        await ensureOffscreen();
        const start: RuntimeMessage = { type: "offscreen:start", streamId, wsUrl: msg.wsUrl };
        await chrome.runtime.sendMessage(start);
        sendResponse({ ok: true });
      } catch (err) {
        const raw = (err as Error).message;
        const friendly = /not been invoked|activeTab/i.test(raw)
          ? "NEEDS_TAB_PICK"
          : /Chrome pages cannot be captured/i.test(raw)
            ? "Esta aba não pode ser capturada."
            : raw;
        sendResponse({ ok: false, error: friendly });
      }
    })();
    return true;
  }
  if (msg.type === "sci:stop-capture") {
    const stop: RuntimeMessage = { type: "offscreen:stop" };
    chrome.runtime.sendMessage(stop).catch(() => undefined);
    void chrome.offscreen.closeDocument().catch(() => undefined);
    sendResponse({ ok: true });
    return;
  }
});
