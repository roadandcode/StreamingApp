/** Form state shared by the sign-in/registration forms and their server actions. */
export interface AuthFormState {
  /** Form-level message (e.g. wrong password). */
  error: string | null;
  /** Messages for individual inputs, keyed by field name (`email`, `password`, `displayName`). */
  fieldErrors: Record<string, string>;
  email: string;
}

export const MIN_PASSWORD_LENGTH = 10;

export const EMPTY_AUTH_STATE: AuthFormState = { error: null, fieldErrors: {}, email: "" };
