import { describe, expect, it } from "vitest";
import { downsample, FrameAssembler, interleavePcm16 } from "./audio.js";

describe("áudio", () => {
  it("reamostra 48 kHz → 16 kHz", () => {
    const input = new Float32Array(4800).fill(0.5);
    const out = downsample(input, 48000);
    expect(out.length).toBe(1600);
    expect(out[0]).toBeCloseTo(0.5);
  });

  it("intercala dois canais em PCM16 LE com saturação", () => {
    const buf = interleavePcm16(Float32Array.from([1, -1, 2]), Float32Array.from([0, 0.5, -2]));
    const v = new DataView(buf);
    expect([
      v.getInt16(0, true),
      v.getInt16(2, true),
      v.getInt16(4, true),
      v.getInt16(6, true),
      v.getInt16(8, true),
      v.getInt16(10, true),
    ]).toEqual([32767, 0, -32768, 16384, 32767, -32768]);
  });

  it("monta quadros de 100 ms (1600 amostras × 2 canais × 2 bytes)", () => {
    const fa = new FrameAssembler();
    expect(fa.push(new Float32Array(1000), new Float32Array(1000))).toHaveLength(0);
    const frames = fa.push(new Float32Array(2500), new Float32Array(2500));
    expect(frames).toHaveLength(2);
    expect(frames[0]!.byteLength).toBe(6400);
  });
});
