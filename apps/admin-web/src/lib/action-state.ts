/** Result of a one-click server action (revoke buttons and the like). */
export type SimpleActionState =
  | { status: "idle" }
  | { status: "done"; message: string }
  | { status: "error"; message: string };
