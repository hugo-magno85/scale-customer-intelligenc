import type { RuntimeMessage } from "./shared/messages.js";
import { getMic, startPipeline } from "./shared/pipeline.js";

let current: { stop: () => Promise<void> } | null = null;

function status(s: "connecting" | "live" | "stopped" | "error", message?: string) {
  const m: RuntimeMessage = { type: "capture:status", status: s, ...(message ? { message } : {}) };
  chrome.runtime.sendMessage(m).catch(() => undefined);
}

async function start(streamId: string, wsUrl: string) {
  await current?.stop();
  status("connecting");
  // Áudio da aba (participantes da reunião)
  const tab = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId },
    } as unknown as MediaTrackConstraints,
    video: false,
  });
  // Microfone do profissional (permissão concedida uma vez em permission.html)
  const mic = await getMic();
  if (!mic)
    status(
      "error",
      "Microfone não autorizado. Abra a página de permissão do Scale Assistant e permita o microfone.",
    );
  current = await startPipeline(
    { tab, mic, wsUrl, workletUrl: "audio-worklet.js", playThrough: true },
    {
      onReady: () => status("live"),
      onServerMessage: (payload) =>
        chrome.runtime
          .sendMessage({ type: "capture:server-message", payload } satisfies RuntimeMessage)
          .catch(() => undefined),
      onClosed: (reason) => {
        current = null;
        status(reason ? "error" : "stopped", reason ?? undefined);
      },
    },
  );
}

chrome.runtime.onMessage.addListener((msg: RuntimeMessage) => {
  if (msg.type === "offscreen:start")
    void start(msg.streamId, msg.wsUrl).catch((err: Error) => status("error", err.message));
  if (msg.type === "offscreen:stop") void current?.stop();
});
