"use client";

import Link from "next/link";
import { useActionState } from "react";
import { register, signIn } from "@/app/actions/auth";
import { EMPTY_AUTH_STATE, MIN_PASSWORD_LENGTH } from "@/app/actions/auth-state";
import styles from "./AuthForm.module.css";

export function AuthForm({ mode, next }: { mode: "login" | "register"; next: string }) {
  const [state, formAction, pending] = useActionState(mode === "login" ? signIn : register, EMPTY_AUTH_STATE);
  const isRegister = mode === "register";
  const fieldError = (name: string) => state.fieldErrors[name];
  const switchHref = `${isRegister ? "/login" : "/register"}${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`;

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="next" value={next} />

      {state.error ? (
        <p className="alert alert-error" role="alert">
          {state.error}
        </p>
      ) : null}

      {isRegister ? (
        <div className="field">
          <label htmlFor="displayName">
            Your name <span className="subtle">(optional)</span>
          </label>
          <input
            id="displayName"
            name="displayName"
            type="text"
            autoComplete="name"
            maxLength={80}
            aria-invalid={fieldError("displayName") ? true : undefined}
            aria-describedby={fieldError("displayName") ? "displayName-error" : undefined}
          />
          {fieldError("displayName") ? (
            <span id="displayName-error" className="field-error">
              {fieldError("displayName")}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.email}
          key={`email-${state.email}`}
          aria-invalid={fieldError("email") ? true : undefined}
          aria-describedby={fieldError("email") ? "email-error" : undefined}
        />
        {fieldError("email") ? (
          <span id="email-error" className="field-error">
            {fieldError("email")}
          </span>
        ) : null}
      </div>

      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={isRegister ? "new-password" : "current-password"}
          required
          minLength={isRegister ? MIN_PASSWORD_LENGTH : undefined}
          aria-invalid={fieldError("password") ? true : undefined}
          aria-describedby={fieldError("password") ? "password-error" : isRegister ? "password-hint" : undefined}
        />
        {fieldError("password") ? (
          <span id="password-error" className="field-error">
            {fieldError("password")}
          </span>
        ) : isRegister ? (
          <span id="password-hint" className="field-hint">
            At least {MIN_PASSWORD_LENGTH} characters.
          </span>
        ) : null}
      </div>

      <button type="submit" className={`btn btn-primary ${styles.submit}`} disabled={pending}>
        {pending ? "Please wait…" : isRegister ? "Create account" : "Sign in"}
      </button>

      <p className={styles.switch}>
        {isRegister ? "Already have an account?" : "New here?"}{" "}
        <Link href={switchHref}>{isRegister ? "Sign in" : "Create a free account"}</Link>
      </p>
    </form>
  );
}
