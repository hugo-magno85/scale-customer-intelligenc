import type { MeetingPlatform } from "@sci/contracts";

export interface DetectedMeeting {
  platform: MeetingPlatform;
  externalRef: string | null;
  title: string | null;
  participants: string[];
  url: string;
  /** true quando a página indica que a reunião está aberta no app desktop (não capturável). */
  desktopHandoff: boolean;
}

export type RuntimeMessage =
  | { type: "sci:meeting-detected"; meeting: DetectedMeeting }
  | { type: "sci:get-detected"; tabId: number }
  | { type: "sci:start-capture"; tabId: number; wsUrl: string }
  | { type: "sci:stop-capture" }
  | { type: "offscreen:start"; streamId: string; wsUrl: string }
  | { type: "offscreen:stop" }
  | { type: "capture:status"; status: "connecting" | "live" | "stopped" | "error"; message?: string }
  | { type: "capture:server-message"; payload: unknown };

export interface StoredAuth {
  token: string;
  expiresAt: string;
}
