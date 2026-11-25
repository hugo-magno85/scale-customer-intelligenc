/**
 * Conversão de áudio para o formato do stream: PCM 16 bits, 16 kHz,
 * 2 canais intercalados (canal 0 = microfone do profissional, canal 1 = áudio da reunião).
 */
export const TARGET_RATE = 16000;

/** Reamostragem por média em janela (antialiasing simples), de inputRate para 16 kHz. */
export function downsample(input: Float32Array, inputRate: number, outRate = TARGET_RATE): Float32Array {
  if (inputRate === outRate) return input;
  if (inputRate < outRate) throw new Error("taxa de entrada menor que a de saída");
  const ratio = inputRate / outRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j]!;
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

function toInt16(v: number): number {
  const s = Math.max(-1, Math.min(1, v));
  return s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
}

/** Intercala dois canais (já em 16 kHz) em PCM16 little-endian. */
export function interleavePcm16(ch0: Float32Array, ch1: Float32Array): ArrayBuffer {
  const n = Math.min(ch0.length, ch1.length);
  const buf = new ArrayBuffer(n * 4);
  const view = new DataView(buf);
  for (let i = 0; i < n; i++) {
    view.setInt16(i * 4, toInt16(ch0[i]!), true);
    view.setInt16(i * 4 + 2, toInt16(ch1[i]!), true);
  }
  return buf;
}

/** Acumula amostras dos dois canais e emite quadros de tamanho fixo (ex.: 100 ms). */
export class FrameAssembler {
  private a: number[] = [];
  private b: number[] = [];
  constructor(private readonly frameSamples = TARGET_RATE / 10) {}
  push(ch0: Float32Array, ch1: Float32Array): ArrayBuffer[] {
    for (const v of ch0) this.a.push(v);
    for (const v of ch1) this.b.push(v);
    const frames: ArrayBuffer[] = [];
    while (this.a.length >= this.frameSamples && this.b.length >= this.frameSamples) {
      frames.push(
        interleavePcm16(
          Float32Array.from(this.a.splice(0, this.frameSamples)),
          Float32Array.from(this.b.splice(0, this.frameSamples)),
        ),
      );
    }
    // evita que um canal atrasado faça o buffer crescer sem limite
    const max = this.frameSamples * 20;
    if (this.a.length > max) this.a.splice(0, this.a.length - max);
    if (this.b.length > max) this.b.splice(0, this.b.length - max);
    return frames;
  }
}
