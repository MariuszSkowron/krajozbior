// The state of the newest application of an account as the screen shows it (spec "Rola
// kuratora", 5.5). Only the use case knows whether the membership still exists and whether the
// organization is approved; this function joins the three facts.

export type ApplicationScreenState =
  "none" | "pending" | "approved_member" | "approved_revoked" | "approved_suspended" | "rejected";

export type ApplicationFacts = Readonly<{
  status: "pending" | "approved" | "rejected";
  /** The membership created by the approval still exists. */
  isMember: boolean;
  /** The organization of the approval is approved (not suspended). */
  organizationApproved: boolean;
}>;

export function applicationScreenState(facts: ApplicationFacts | null): ApplicationScreenState {
  if (facts === null) {
    return "none";
  }
  if (facts.status !== "approved") {
    return facts.status;
  }
  if (!facts.isMember) {
    return "approved_revoked";
  }

  return facts.organizationApproved ? "approved_member" : "approved_suspended";
}

/** The form is shown unless an application waits for a decision. */
export function mayApply(state: ApplicationScreenState): boolean {
  return state !== "pending";
}
