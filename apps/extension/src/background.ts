import { WEB_URL } from "./shared/env.js";
import type { DetectedMeeting, RuntimeMessage, StoredAuth } from "./shared/messages.js";

const detected = new Map<number, DetectedMeeting>();

// O clique no ícone abre o painel E concede activeTab na aba da reunião — sem isso o Chrome recusa
// chrome.tabCapture ("Extension has not been invoked"). Por isso abrimos o painel manualmente.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => undefined);
chrome.action.onClicked.addListener((tab) => {
  // Precisa ser síncrono dentro do gesto do usuário
  if (tab.windowId != null) void chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
  // Avisa o painel (se já estiver aberto) para iniciar a captura que estava aguardando a liberação
  if (tab.id != null) {
    const m: RuntimeMessage = { type: "sci:action-clicked", tabId: tab.id };
    chrome.runtime.sendMessage(m).catch(() => undefined);
  }
});

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

// Uma captura anterior (pausa, painel fechado, versão antiga) pode ainda estar presa à aba:
// encerra o documento offscreen, que libera todos os fluxos, e tenta de novo.
async function getStreamId(tabId: number): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    } catch (err) {
      if (!/active stream/i.test((err as Error).message) || attempt >= 4) throw err;
      await chrome.offscreen.closeDocument().catch(() => undefined);
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
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
        const streamId = await getStreamId(msg.tabId);
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
            : /active stream/i.test(raw)
              ? "A aba ainda está presa a uma captura anterior. Recarregue a aba da reunião (F5), clique no ícone do Scale Assistant e inicie de novo."
              : raw;
        sendResponse({ ok: false, error: friendly });
      }
    })();
    return true;
  }
  if (msg.type === "sci:stop-capture") {
    const stop: RuntimeMessage = { type: "offscreen:stop" };
    void (async () => {
      await chrome.runtime.sendMessage(stop).catch(() => undefined);
      await chrome.offscreen.closeDocument().catch(() => undefined);
      sendResponse({ ok: true });
    })();
    return true;
  }
});
