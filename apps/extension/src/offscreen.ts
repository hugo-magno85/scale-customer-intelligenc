import { downsample, FrameAssembler } from "./shared/audio.js";
import type { RuntimeMessage } from "./shared/messages.js";

let ctx: AudioContext | null = null;
let ws: WebSocket | null = null;
let streams: MediaStream[] = [];

function status(s: "connecting" | "live" | "stopped" | "error", message?: string) {
  const m: RuntimeMessage = { type: "capture:status", status: s, ...(message ? { message } : {}) };
  chrome.runtime.sendMessage(m).catch(() => undefined);
}

async function stop(reason?: string) {
  ws?.close(1000);
  ws = null;
  streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  streams = [];
  await ctx?.close().catch(() => undefined);
  ctx = null;
  status(reason ? "error" : "stopped", reason);
}

async function start(streamId: string, wsUrl: string) {
  await stop();
  status("connecting");
  // Áudio da aba (participantes da reunião)
  const tab = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId },
    } as unknown as MediaTrackConstraints,
    video: false,
  });
  // Microfone do profissional (permissão concedida uma vez em permission.html)
  let mic: MediaStream | null = null;
  try {
    mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
  } catch {
    status(
      "error",
      "Microfone não autorizado. Abra as configurações do Scale Assistant e permita o microfone.",
    );
  }
  streams = [tab, ...(mic ? [mic] : [])];

  ctx = new AudioContext();
  await ctx.audioWorklet.addModule("audio-worklet.js");
  const tabSrc = ctx.createMediaStreamSource(tab);
  // Mantém o som da reunião audível para o usuário (a captura da aba silencia a saída)
  tabSrc.connect(ctx.destination);
  const merger = ctx.createChannelMerger(2);
  if (mic) ctx.createMediaStreamSource(mic).connect(merger, 0, 0);
  tabSrc.connect(merger, 0, 1);
  const node = new AudioWorkletNode(ctx, "sci-capture", {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 2,
    channelCountMode: "explicit",
  });
  merger.connect(node);

  const assembler = new FrameAssembler();
  const rate = ctx.sampleRate;
  ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";
  ws.onmessage = (e) => {
    try {
      const payload = JSON.parse(String(e.data));
      if (payload.type === "ready") status("live");
      chrome.runtime
        .sendMessage({ type: "capture:server-message", payload } satisfies RuntimeMessage)
        .catch(() => undefined);
    } catch {
      /* ignora */
    }
  };
  ws.onclose = (e) => {
    if (ws) void stop(e.code === 1000 ? undefined : `Conexão de captura encerrada (${e.code})`);
  };
  node.port.onmessage = (e: MessageEvent<[Float32Array, Float32Array]>) => {
    if (ws?.readyState !== WebSocket.OPEN) return;
    for (const frame of assembler.push(downsample(e.data[0], rate), downsample(e.data[1], rate)))
      ws.send(frame);
  };
}

chrome.runtime.onMessage.addListener((msg: RuntimeMessage) => {
  if (msg.type === "offscreen:start")
    void start(msg.streamId, msg.wsUrl).catch((err: Error) => stop(err.message));
  if (msg.type === "offscreen:stop") void stop();
});
