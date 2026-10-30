export type ObservationStatus = "draft" | "submitted" | "clarification_requested" | "rejected" | "published" | "reported" | "withdrawn";

// Every transition not listed here is rejected. `published -> submitted` is the renewed review after a material edit.
export const OBSERVATION_TRANSITIONS: Record<ObservationStatus, ObservationStatus[]> = {
  draft: ["submitted", "withdrawn"],
  submitted: ["clarification_requested", "rejected", "published", "withdrawn"],
  clarification_requested: ["draft", "withdrawn"],
  rejected: [],
  published: ["reported", "withdrawn", "submitted"],
  reported: ["published", "withdrawn"],
  withdrawn: [],
};

export type ImprovementStatus = "Proposed" | "Under review" | "Planned" | "In progress" | "Released" | "Not proceeding";
export const IMPROVEMENT_STATUSES: ImprovementStatus[] = ["Proposed", "Under review", "Planned", "In progress", "Released", "Not proceeding"];
export const IMPROVEMENT_TRANSITIONS: Record<ImprovementStatus, ImprovementStatus[]> = {
  Proposed: ["Under review", "Not proceeding"],
  "Under review": ["Planned", "Not proceeding"],
  Planned: ["In progress", "Not proceeding"],
  "In progress": ["Released", "Planned"],
  Released: [],
  "Not proceeding": [],
};

export function canTransition<S extends string>(map: Record<S, S[]>, from: S, to: S) {
  return map[from]?.includes(to) ?? false;
}

export class WorkflowError extends Error {
  status = 409;
  constructor(from: string, to: string) { super(`Transition ${from} → ${to} is not permitted`); }
}
export function assertTransition<S extends string>(map: Record<S, S[]>, from: S, to: S) {
  if (!canTransition(map, from, to)) throw new WorkflowError(from, to);
}
