import type {
  ChecklistItem,
  Indicator,
  LiveSignal,
  MeetingType,
  PlaybookStructure,
  Priority,
  QuestionType,
  Suggestion,
  TenantSkillSettings,
} from "@sci/contracts";

export interface Segment {
  id: number | null;
  speaker: "internal" | "customer";
  text: string;
  startMs: number;
}

export interface BrainContext {
  meetingId: string;
  meetingType: MeetingType;
  objective: string | null;
  playbook: PlaybookStructure | null;
  settings: TenantSkillSettings;
  customer: { name: string; segment: string | null } | null;
  /** Pontos do histórico do cliente (análises anteriores, sinais abertos). Etapas 5/7 alimentam. */
  history: string[];
}

export interface Candidate {
  key: string;
  text: string;
  type: QuestionType;
  indicator: Indicator | null;
  priority: Priority;
  purpose: string;
  source: "playbook" | "library" | "followup";
  playbookQuestionKey: string | null;
  signals: string[];
  covers: string[];
  followUps: string[];
  weight: number;
  required: boolean;
}

export interface BrainPersistence {
  suggestion(s: Suggestion): Promise<number | void>;
  suggestionStatus(id: string, status: Suggestion["status"]): Promise<void>;
  signal(s: LiveSignal): Promise<void>;
  checklist(items: ChecklistItem[]): Promise<void>;
}
