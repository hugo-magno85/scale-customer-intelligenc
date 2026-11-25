// AudioWorklet: entrega blocos Float32 dos 2 canais (mic, reunião) ao documento offscreen.
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: unknown): void;

class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    if (input && input.length >= 2 && input[0] && input[1]) {
      this.port.postMessage([input[0].slice(), input[1].slice()]);
    }
    return true;
  }
}
registerProcessor("sci-capture", CaptureProcessor);
