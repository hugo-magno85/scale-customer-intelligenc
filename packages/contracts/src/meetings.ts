import { z } from "zod";
import { Uuid } from "./common.js";
import { MeetingType } from "./playbooks.js";

export const MeetingPlatform = z.enum(["google_meet", "zoom", "teams", "other"]);
export type MeetingPlatform = z.infer<typeof MeetingPlatform>;

export const MEETING_PLATFORM_LABELS: Record<MeetingPlatform, string> = {
  google_meet: "Google Meet",
  zoom: "Zoom",
  teams: "Microsoft Teams",
  other: "Outra",
};

export const MeetingStatus = z.enum(["preparing", "live", "ended", "analyzed"]);
export type MeetingStatus = z.infer<typeof MeetingStatus>;

export const ConsentMethod = z.enum(["verbal_announcement", "written", "platform_notice"]);
export type ConsentMethod = z.infer<typeof ConsentMethod>;

export const ParticipantInput = z.object({
  displayName: z.string().trim().min(1).max(200),
  email: z.email().max(254).nullish(),
  role: z.enum(["internal", "customer", "unknown"]).default("unknown"),
  contactId: Uuid.nullish(),
  source: z.enum(["platform", "manual"]).default("manual"),
});
export type ParticipantInput = z.infer<typeof ParticipantInput>;

export const Participant = z.object({
  id: Uuid,
  displayName: z.string(),
  email: z.string().nullable(),
  role: z.enum(["internal", "customer", "unknown"]),
  contactId: Uuid.nullable(),
  source: z.enum(["platform", "manual"]),
});
export type Participant = z.infer<typeof Participant>;

export const Meeting = z.object({
  id: Uuid,
  ownerUserId: Uuid,
  ownerName: z.string().nullable(),
  customerId: Uuid.nullable(),
  customerName: z.string().nullable(),
  playbookVersionId: Uuid.nullable(),
  playbookName: z.string().nullable(),
  playbookVersionNumber: z.number().int().nullable(),
  skillVersion: z.string().nullable(),
  platform: MeetingPlatform,
  externalRef: z.string().nullable(),
  title: z.string().nullable(),
  meetingType: MeetingType,
  objective: z.string().nullable(),
  status: MeetingStatus,
  consentMethod: ConsentMethod.nullable(),
  consentConfirmedAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  createdAt: z.string(),
  participants: z.array(Participant),
});
export type Meeting = z.infer<typeof Meeting>;

export const CreateMeetingRequest = z.object({
  platform: MeetingPlatform,
  externalRef: z.string().trim().max(300).nullish(),
  title: z.string().trim().max(300).nullish(),
  meetingType: MeetingType.default("other"),
  objective: z.string().trim().max(1000).nullish(),
  customerId: Uuid.nullish(),
  /** Usa a versão publicada deste playbook (registrada na reunião). */
  playbookId: Uuid.nullish(),
  participants: z.array(ParticipantInput).max(100).default([]),
});
export type CreateMeetingRequest = z.infer<typeof CreateMeetingRequest>;

export const UpdateMeetingRequest = z.object({
  title: z.string().trim().max(300).nullish(),
  meetingType: MeetingType.optional(),
  objective: z.string().trim().max(1000).nullish(),
  customerId: Uuid.nullish(),
  playbookId: Uuid.nullish(),
});

export const ConsentRequest = z.object({
  method: ConsentMethod,
  /** O profissional confirma que informou os participantes sobre a captura. */
  confirmed: z.literal(true),
});

export const StreamTicket = z.object({ ticket: z.string(), expiresAt: z.string(), wsPath: z.string() });
export type StreamTicket = z.infer<typeof StreamTicket>;

export const TranscriptSegment = z.object({
  id: z.number().int(),
  channel: z.union([z.literal(0), z.literal(1)]),
  speaker: z.enum(["internal", "customer"]),
  startMs: z.number().int(),
  endMs: z.number().int(),
  text: z.string(),
  confidence: z.number().nullable(),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegment>;

/** Mensagens servidor → extensão no WebSocket de áudio. */
export const StreamServerMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready"), meetingId: Uuid, sampleRate: z.number(), channels: z.number() }),
  z.object({
    type: z.literal("interim"),
    channel: z.number(),
    speaker: z.enum(["internal", "customer"]),
    text: z.string(),
  }),
  z.object({ type: z.literal("segment"), segment: TranscriptSegment }),
  z.object({ type: z.literal("error"), code: z.string(), message: z.string() }),
  z.object({ type: z.literal("closed"), reason: z.string() }),
]);
export type StreamServerMessage = z.infer<typeof StreamServerMessage>;

/** Formato do áudio enviado pela extensão. */
export const STREAM_AUDIO = { sampleRate: 16000, channels: 2, encoding: "linear16" } as const;
