"use client";

import { useActionState } from "react";
import {
  AGE_RATING_MAX_LENGTH,
  AGE_RATING_SUGGESTIONS,
  DESCRIPTION_MAX_LENGTH,
  LANGUAGE_SUGGESTIONS,
  THUMBNAIL_URL_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  type ContentField,
  type ContentFormState,
  type ContentFormValues,
} from "@/lib/content-form";

interface ContentFormProps {
  mode: "create" | "edit";
  action: (previous: ContentFormState, formData: FormData) => Promise<ContentFormState>;
  initialValues: ContentFormValues;
  /** Kinds the admin may pick; a single entry fixes the kind. */
  kindOptions: { value: string; label: string }[];
  /** Set when creating a lesson inside a course. */
  parent?: { id: string; title: string };
  submitLabel: string;
}

export function ContentForm({ mode, action, initialValues, kindOptions, parent, submitLabel }: ContentFormProps) {
  const [state, formAction, pending] = useActionState(action, {
    status: "idle",
    values: initialValues,
    fieldErrors: {},
  } satisfies ContentFormState);

  const values = state.values;
  const isLesson = values.kind === "lesson" || kindOptions.every((option) => option.value === "lesson");
  const errorFor = (field: ContentField) => state.fieldErrors[field];
  const describedBy = (field: ContentField, hintId?: string) =>
    [errorFor(field) ? `${field}-error` : null, hintId ?? null].filter(Boolean).join(" ") || undefined;

  const fieldError = (field: ContentField) =>
    errorFor(field) ? (
      <p className="field-error" id={`${field}-error`}>
        {errorFor(field)}
      </p>
    ) : null;

  // Errors for fields this form does not show as inputs go into the summary at the top.
  const hiddenFields: ContentField[] = [
    ...(kindOptions.length > 1 ? [] : (["kind"] as const)),
    ...(parent ? [] : (["parentId"] as const)),
    ...(isLesson ? [] : (["position"] as const)),
  ];
  const hiddenErrors = hiddenFields.map(errorFor).filter((message): message is string => Boolean(message));

  return (
    <form action={formAction} noValidate aria-label={mode === "create" ? "Create content" : "Edit content"}>
      {state.status === "error" && (state.formError || hiddenErrors.length > 0) ? (
        <div className="alert alert-error" role="alert">
          {state.formError ? <p>{state.formError}</p> : null}
          {hiddenErrors.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      ) : null}
      {state.status === "saved" ? (
        <div className="alert alert-success" role="status">
          <p>Changes saved.</p>
        </div>
      ) : null}

      {kindOptions.length > 1 ? (
        <fieldset className="field" style={{ border: 0, padding: 0, margin: "0 0 1rem" }}>
          <legend className="label">Type</legend>
          <div className="radio-row">
            {kindOptions.map((option) => (
              <label key={option.value}>
                <input type="radio" name="kind" value={option.value} defaultChecked={values.kind === option.value} />
                {option.label}
              </label>
            ))}
          </div>
          {fieldError("kind")}
        </fieldset>
      ) : (
        <input type="hidden" name="kind" value={kindOptions[0]?.value ?? values.kind} />
      )}

      {parent ? (
        <>
          <input type="hidden" name="parentId" value={parent.id} />
          <p className="muted" style={{ marginTop: 0 }}>
            Course: <strong>{parent.title}</strong>
          </p>
          {fieldError("parentId")}
        </>
      ) : null}

      <div className="field">
        <label htmlFor="title">Title</label>
        <input
          id="title"
          name="title"
          type="text"
          required
          maxLength={TITLE_MAX_LENGTH}
          defaultValue={values.title}
          aria-invalid={errorFor("title") ? true : undefined}
          aria-describedby={describedBy("title")}
        />
        {fieldError("title")}
      </div>

      <div className="field">
        <label htmlFor="description">Description</label>
        <textarea
          id="description"
          name="description"
          required
          maxLength={DESCRIPTION_MAX_LENGTH}
          defaultValue={values.description}
          aria-invalid={errorFor("description") ? true : undefined}
          aria-describedby={describedBy("description")}
        />
        {fieldError("description")}
      </div>

      <div className="field">
        <label htmlFor="thumbnailUrl">
          Thumbnail URL <span className="optional">(optional)</span>
        </label>
        <input
          id="thumbnailUrl"
          name="thumbnailUrl"
          type="url"
          inputMode="url"
          maxLength={THUMBNAIL_URL_MAX_LENGTH}
          placeholder="https://"
          defaultValue={values.thumbnailUrl}
          aria-invalid={errorFor("thumbnailUrl") ? true : undefined}
          aria-describedby={describedBy("thumbnailUrl", "thumbnailUrl-hint")}
        />
        <p className="hint" id="thumbnailUrl-hint">
          Public image shown in the app. Leave empty for none.
        </p>
        {fieldError("thumbnailUrl")}
      </div>

      <fieldset className="field" style={{ border: 0, padding: 0, margin: "0 0 1rem" }}>
        <legend className="label">Access</legend>
        <div className="radio-row">
          <label>
            <input type="radio" name="accessTier" value="premium" defaultChecked={values.accessTier === "premium"} />
            Premium (subscribers)
          </label>
          <label>
            <input type="radio" name="accessTier" value="free" defaultChecked={values.accessTier === "free"} />
            Free
          </label>
        </div>
        {fieldError("accessTier")}
      </fieldset>

      <div className="form-grid">
        <div className="field">
          <label htmlFor="defaultLanguage">Default language</label>
          <input
            id="defaultLanguage"
            name="defaultLanguage"
            type="text"
            list="language-options"
            required
            defaultValue={values.defaultLanguage}
            aria-invalid={errorFor("defaultLanguage") ? true : undefined}
            aria-describedby={describedBy("defaultLanguage", "defaultLanguage-hint")}
          />
          <datalist id="language-options">
            {LANGUAGE_SUGGESTIONS.map((language) => (
              <option key={language.code} value={language.code}>
                {language.label}
              </option>
            ))}
          </datalist>
          <p className="hint" id="defaultLanguage-hint">
            Language code, e.g. hi (Hindi), en (English), ta (Tamil).
          </p>
          {fieldError("defaultLanguage")}
        </div>

        <div className="field">
          <label htmlFor="ageRating">
            Age rating <span className="optional">(optional)</span>
          </label>
          <input
            id="ageRating"
            name="ageRating"
            type="text"
            list="age-rating-options"
            maxLength={AGE_RATING_MAX_LENGTH}
            defaultValue={values.ageRating}
            aria-invalid={errorFor("ageRating") ? true : undefined}
            aria-describedby={describedBy("ageRating", "ageRating-hint")}
          />
          <datalist id="age-rating-options">
            {AGE_RATING_SUGGESTIONS.map((rating) => (
              <option key={rating} value={rating} />
            ))}
          </datalist>
          <p className="hint" id="ageRating-hint">
            CBFC category such as U, UA 13+ or A.
          </p>
          {fieldError("ageRating")}
        </div>

        <div className="field">
          <label htmlFor="regions">Regions</label>
          <input
            id="regions"
            name="regions"
            type="text"
            required
            defaultValue={values.regions}
            aria-invalid={errorFor("regions") ? true : undefined}
            aria-describedby={describedBy("regions", "regions-hint")}
          />
          <p className="hint" id="regions-hint">
            Countries where it may be watched, as comma-separated ISO codes (e.g. IN, NP).
          </p>
          {fieldError("regions")}
        </div>

        {isLesson ? (
          <div className="field">
            <label htmlFor="position">
              Position <span className="optional">(optional)</span>
            </label>
            <input
              id="position"
              name="position"
              type="number"
              min={0}
              step={1}
              defaultValue={values.position}
              aria-invalid={errorFor("position") ? true : undefined}
              aria-describedby={describedBy("position", "position-hint")}
            />
            <p className="hint" id="position-hint">
              {mode === "create"
                ? "Leave blank to add after the last lesson. 0 is first."
                : "Order within the course; 0 is first."}
            </p>
            {fieldError("position")}
          </div>
        ) : null}
      </div>

      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
