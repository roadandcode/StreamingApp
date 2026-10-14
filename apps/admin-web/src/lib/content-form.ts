import {
  ACCESS_TIERS,
  CONTENT_KINDS,
  type AccessTier,
  type AdminContent,
  type ContentKind,
  type CreateContentRequest,
  type UpdateContentRequest,
} from "./api/types";

/**
 * Parsing and validation for the create/edit content forms. Pure functions, used by the server
 * actions; the client form only renders what they return.
 */

export const CONTENT_FIELDS = [
  "kind",
  "title",
  "description",
  "accessTier",
  "defaultLanguage",
  "ageRating",
  "regions",
  "parentId",
  "position",
] as const;

export type ContentField = (typeof CONTENT_FIELDS)[number];

/** Raw form values, echoed back to the form so nothing typed is lost on an error. */
export type ContentFormValues = Record<ContentField, string>;

export type FieldErrors = Partial<Record<ContentField, string>>;

export interface ContentFormState {
  status: "idle" | "error" | "saved";
  values: ContentFormValues;
  fieldErrors: FieldErrors;
  formError?: string;
}

export const TITLE_MAX_LENGTH = 200;
export const DESCRIPTION_MAX_LENGTH = 5000;
export const AGE_RATING_MAX_LENGTH = 20;

export const LANGUAGE_SUGGESTIONS: { code: string; label: string }[] = [
  { code: "hi", label: "Hindi" },
  { code: "en", label: "English" },
  { code: "bn", label: "Bengali" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "mr", label: "Marathi" },
  { code: "gu", label: "Gujarati" },
  { code: "kn", label: "Kannada" },
  { code: "ml", label: "Malayalam" },
  { code: "pa", label: "Punjabi" },
  { code: "or", label: "Odia" },
  { code: "ur", label: "Urdu" },
];

/** CBFC certificate categories. */
export const AGE_RATING_SUGGESTIONS = ["U", "UA 7+", "UA 13+", "UA 16+", "A"];

const LANGUAGE_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const REGION_PATTERN = /^[A-Z]{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function emptyContentValues(overrides: Partial<ContentFormValues> = {}): ContentFormValues {
  return {
    kind: "video",
    title: "",
    description: "",
    accessTier: "premium",
    defaultLanguage: "hi",
    ageRating: "",
    regions: "IN",
    parentId: "",
    position: "",
    ...overrides,
  };
}

export function contentToValues(content: AdminContent): ContentFormValues {
  return {
    kind: content.kind,
    title: content.title,
    description: content.description,
    accessTier: content.accessTier,
    defaultLanguage: content.defaultLanguage,
    ageRating: content.ageRating ?? "",
    regions: content.regions.join(", "),
    parentId: content.parentId ?? "",
    position: String(content.position),
  };
}

export function readContentValues(formData: FormData): ContentFormValues {
  const values = emptyContentValues();
  for (const field of CONTENT_FIELDS) {
    const raw = formData.get(field);
    values[field] = typeof raw === "string" ? raw : "";
  }
  return values;
}

export function parseRegions(raw: string): string[] {
  const codes = raw
    .split(/[\s,]+/)
    .map((code) => code.trim().toUpperCase())
    .filter((code) => code.length > 0);
  return [...new Set(codes)];
}

interface ValidatedFields {
  kind: ContentKind;
  title: string;
  description: string;
  accessTier: AccessTier;
  defaultLanguage: string;
  ageRating: string | null;
  regions: string[];
  parentId: string | null;
  position: number | null;
}

function validate(values: ContentFormValues): { fields: ValidatedFields; errors: FieldErrors } {
  const errors: FieldErrors = {};

  const kind = values.kind as ContentKind;
  if (!CONTENT_KINDS.includes(kind)) {
    errors.kind = "Choose a content type.";
  }

  const title = values.title.trim();
  if (title.length === 0) {
    errors.title = "Enter a title.";
  } else if (title.length > TITLE_MAX_LENGTH) {
    errors.title = `Keep the title under ${TITLE_MAX_LENGTH} characters.`;
  }

  const description = values.description.trim();
  if (description.length === 0) {
    errors.description = "Enter a description.";
  } else if (description.length > DESCRIPTION_MAX_LENGTH) {
    errors.description = `Keep the description under ${DESCRIPTION_MAX_LENGTH} characters.`;
  }

  const accessTier = values.accessTier as AccessTier;
  if (!ACCESS_TIERS.includes(accessTier)) {
    errors.accessTier = "Choose free or premium.";
  }

  const defaultLanguage = values.defaultLanguage.trim();
  if (!LANGUAGE_PATTERN.test(defaultLanguage)) {
    errors.defaultLanguage = "Use a language code such as hi, en or ta-IN.";
  }

  const ageRating = values.ageRating.trim();
  if (ageRating.length > AGE_RATING_MAX_LENGTH) {
    errors.ageRating = `Keep the age rating under ${AGE_RATING_MAX_LENGTH} characters.`;
  }

  const regions = parseRegions(values.regions);
  if (regions.length === 0) {
    errors.regions = "Enter at least one country code, for example IN.";
  } else {
    const invalid = regions.filter((code) => !REGION_PATTERN.test(code));
    if (invalid.length > 0) {
      errors.regions = `Use two-letter ISO country codes such as IN or NP (not ${invalid.join(", ")}).`;
    }
  }

  const parentId = values.parentId.trim();
  if (kind === "lesson") {
    if (!UUID_PATTERN.test(parentId)) {
      errors.parentId = "A lesson must belong to a course. Add lessons from the course page.";
    }
  } else if (parentId.length > 0) {
    errors.parentId = "Only lessons can belong to a course.";
  }

  let position: number | null = null;
  const rawPosition = values.position.trim();
  if (kind === "lesson" && rawPosition.length > 0) {
    const parsed = Number(rawPosition);
    if (!Number.isInteger(parsed) || parsed < 0) {
      errors.position = "Position must be a whole number (0 or more).";
    } else {
      position = parsed;
    }
  }

  return {
    errors,
    fields: {
      kind,
      title,
      description,
      accessTier,
      defaultLanguage,
      ageRating: ageRating.length > 0 ? ageRating : null,
      regions,
      parentId: parentId.length > 0 ? parentId : null,
      position,
    },
  };
}

export function hasErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0;
}

export function buildCreateRequest(values: ContentFormValues): { body?: CreateContentRequest; errors: FieldErrors } {
  const { fields, errors } = validate(values);
  if (hasErrors(errors)) {
    return { errors };
  }
  const body: CreateContentRequest = {
    kind: fields.kind,
    title: fields.title,
    description: fields.description,
    accessTier: fields.accessTier,
    defaultLanguage: fields.defaultLanguage,
    regions: fields.regions,
  };
  if (fields.ageRating !== null) body.ageRating = fields.ageRating;
  if (fields.kind === "lesson" && fields.parentId !== null) body.parentId = fields.parentId;
  if (fields.kind === "lesson" && fields.position !== null) body.position = fields.position;
  return { body, errors };
}

/** Builds a PATCH body with only the fields that changed. Kind and parent cannot be edited here. */
export function buildUpdateRequest(
  values: ContentFormValues,
  current: AdminContent,
): { body?: UpdateContentRequest; errors: FieldErrors } {
  const { fields, errors } = validate({
    ...values,
    kind: current.kind,
    parentId: current.parentId ?? "",
  });
  if (hasErrors(errors)) {
    return { errors };
  }

  const body: UpdateContentRequest = {};
  if (fields.title !== current.title) body.title = fields.title;
  if (fields.description !== current.description) body.description = fields.description;
  if (fields.accessTier !== current.accessTier) body.accessTier = fields.accessTier;
  if (fields.defaultLanguage !== current.defaultLanguage) body.defaultLanguage = fields.defaultLanguage;
  if (fields.ageRating !== current.ageRating) body.ageRating = fields.ageRating;
  if (fields.regions.join(",") !== current.regions.join(",")) body.regions = fields.regions;
  if (current.kind === "lesson" && fields.position !== null && fields.position !== current.position) {
    body.position = fields.position;
  }
  return { body, errors };
}

/** Best-effort mapping of an API validation message onto the field it mentions. */
export function fieldFromApiMessage(message: string): ContentField | undefined {
  const lower = message.toLowerCase();
  return CONTENT_FIELDS.find((field) => new RegExp(`\\b${field.toLowerCase()}\\b`).test(lower));
}
