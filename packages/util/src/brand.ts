/**
 * User-facing product identity.
 *
 * Internal `@opencode/*` package names and `OPENCODE_*` environment variables deliberately keep their
 * upstream spelling so that updates from OpenCode can still be merged. Anything a user reads or types
 * — the binary name, help text, window title, and the folders Orbit stores its data in — comes from here.
 */
export const name = "orbit"
export const displayName = "Orbit"

/** Previous product name. Only the one-time data migration and legacy lookups should use it. */
export const legacy = "opencode"
