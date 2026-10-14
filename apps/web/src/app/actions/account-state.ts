export interface DeleteAccountState {
  error: string | null;
}

/** The word the viewer must type before the account is deleted. */
export const DELETE_CONFIRMATION = "DELETE";
