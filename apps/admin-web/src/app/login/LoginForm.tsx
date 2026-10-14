"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";
import styles from "./login.module.css";

export function LoginForm({ next, notice }: { next: string | null; notice: string | null }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, { email: "" });

  return (
    <form action={formAction} className={styles.form} noValidate>
      {notice && !state.error ? (
        <div className="alert alert-info" role="status">
          <p>{notice}</p>
        </div>
      ) : null}
      {state.error ? (
        <div className="alert alert-error" role="alert">
          <p>{state.error}</p>
        </div>
      ) : null}

      {next ? <input type="hidden" name="next" value={next} /> : null}

      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          defaultValue={state.email}
          aria-invalid={state.fieldErrors?.email ? true : undefined}
          aria-describedby={state.fieldErrors?.email ? "email-error" : undefined}
        />
        {state.fieldErrors?.email ? (
          <p className="field-error" id="email-error">
            {state.fieldErrors.email}
          </p>
        ) : null}
      </div>

      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={state.fieldErrors?.password ? true : undefined}
          aria-describedby={state.fieldErrors?.password ? "password-error" : undefined}
        />
        {state.fieldErrors?.password ? (
          <p className="field-error" id="password-error">
            {state.fieldErrors.password}
          </p>
        ) : null}
      </div>

      <button type="submit" className={`btn btn-primary ${styles.submit}`} disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
