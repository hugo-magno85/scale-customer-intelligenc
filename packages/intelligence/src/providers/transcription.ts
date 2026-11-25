export interface TranscriptResult {
  channel: number;
  text: string;
  isFinal: boolean;
  startMs: number;
  endMs: number;
  confidence: number | null;
}

export interface TranscriptionEvents {
  onResult(r: TranscriptResult): void;
  onError(err: Error): void;
  onClose(reason: string): void;
}

export interface TranscriptionOptions {
  sampleRate: number;
  channels: number;
  /** Termos do domínio do cliente (produto, empresa) para melhorar o reconhecimento. */
  keyterms?: string[];
}

export interface TranscriptionSession {
  sendAudio(chunk: Buffer): void;
  /** Força a emissão do que estiver pendente. */
  finalize(): void;
  close(): Promise<void>;
}

export interface TranscriptionProvider {
  readonly name: string;
  open(opts: TranscriptionOptions, events: TranscriptionEvents): Promise<TranscriptionSession>;
}
