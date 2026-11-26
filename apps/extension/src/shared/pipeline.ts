import { downsample, FrameAssembler } from "./audio.js";

export interface PipelineCallbacks {
  onReady(): void;
  onServerMessage(payload: unknown): void;
  onClosed(reason: string | null): void;
}

/**
 * Captura → PCM16 16 kHz estéreo (canal 0 = microfone, canal 1 = reunião) → WebSocket.
 * Usado pelo documento offscreen (tabCapture) e pelo painel lateral (seleção de aba pelo usuário).
 */
export async function startPipeline(
  opts: {
    tab: MediaStream;
    mic: MediaStream | null;
    wsUrl: string;
    workletUrl: string;
    playThrough: boolean;
  },
  cb: PipelineCallbacks,
): Promise<{ stop: () => Promise<void> }> {
  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule(opts.workletUrl);
  const tabSrc = ctx.createMediaStreamSource(opts.tab);
  // tabCapture silencia a aba: reproduzimos o áudio para o usuário continuar ouvindo.
  // Na seleção de aba pelo usuário o Chrome mantém o som, então não reproduzimos (evita eco).
  if (opts.playThrough) tabSrc.connect(ctx.destination);
  const merger = ctx.createChannelMerger(2);
  if (opts.mic) ctx.createMediaStreamSource(opts.mic).connect(merger, 0, 0);
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
  let closed = false;
  const ws = new WebSocket(opts.wsUrl);
  ws.binaryType = "arraybuffer";

  const stop = async (reason: string | null = null) => {
    if (closed) return;
    closed = true;
    try {
      ws.close(1000);
    } catch {
      /* já fechado */
    }
    for (const s of [opts.tab, opts.mic]) s?.getTracks().forEach((t) => t.stop());
    await ctx.close().catch(() => undefined);
    cb.onClosed(reason);
  };

  ws.onmessage = (e) => {
    try {
      const payload = JSON.parse(String(e.data)) as { type?: string };
      if (payload.type === "ready") cb.onReady();
      cb.onServerMessage(payload);
    } catch {
      /* ignora */
    }
  };
  ws.onclose = (e) => void stop(e.code === 1000 ? null : `Conexão de captura encerrada (${e.code})`);
  node.port.onmessage = (e: MessageEvent<[Float32Array, Float32Array]>) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    for (const frame of assembler.push(downsample(e.data[0], rate), downsample(e.data[1], rate)))
      ws.send(frame);
  };
  // Se o usuário parar o compartilhamento pela barra do Chrome
  opts.tab
    .getAudioTracks()[0]
    ?.addEventListener("ended", () => void stop("O compartilhamento da aba foi interrompido."));
  return { stop: () => stop(null) };
}

export async function getMic(): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
  } catch {
    return null;
  }
}
