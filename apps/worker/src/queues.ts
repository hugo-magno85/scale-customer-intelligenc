/**
 * Registro central das filas. Cada etapa do roadmap adiciona suas filas
 * aqui (ex.: playbook.extract na Etapa 2, meeting.analyze na Etapa 5).
 */
export const QUEUES = {
  maintenance: "sci.maintenance",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
