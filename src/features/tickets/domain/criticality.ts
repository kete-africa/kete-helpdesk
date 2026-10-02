/**
 * How serious a ticket is: decided by a grid, never by an impression (the usual
 * service-level grid). Each criticality has its target, from acknowledgement to restoration.
 */
export const criticalities = ['critical', 'major', 'standard', 'minor'] as const;
export type Criticality = (typeof criticalities)[number];

/** Hours from acknowledgement to restoration; « minor » is five working days. */
export const targetHours: Readonly<Record<Criticality, number>> = {
  critical: 4,
  major: 8,
  standard: 24,
  minor: 120,
};
