/**
 * Maximum length of each free-text profile field.
 *
 * Imported by both the worker (which rejects over-limit input) and the form
 * (which counts characters as students type). Keep it the single definition —
 * if the two sides disagree, the counter says a field is fine while the server
 * returns a 400.
 */
export const PROFILE_FIELD_LIMITS = {
  displayName: 100,
  pronunciation: 200,
  favoriteDrink: 200,
  dietaryNotes: 1000,
  interests: 1000,
} as const;

export type ProfileFieldName = keyof typeof PROFILE_FIELD_LIMITS;

/** Show the remaining-character warning once this few characters are left. */
export const CHARACTERS_REMAINING_WARNING = 20;
