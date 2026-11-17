export * as SessionErrorMessage from "./error-message.js"

import type { SessionError } from "@opencode/schema/session-error"

/** Where each provider hands out keys, in the order a first-run user is likely to need them. */
export const KEY_PAGES = {
  google: "https://aistudio.google.com/apikey",
  openrouter: "https://openrouter.ai/keys",
} as const

/**
 * Plain English for the failures a person can fix, and undefined for the ones only a developer can.
 *
 * Nothing here inspects a provider name: the message says what happened and what to type next, which
 * is what a first-run user needs, and the raw provider text stays where it is for bug reports.
 */
export const friendly = (error: SessionError.Error): string | undefined => {
  switch (error.type) {
    case "provider.auth":
      return `The provider rejected that API key. Paste a new one with "orbit auth login google" (free key: ${KEY_PAGES.google}) or "orbit auth login openrouter" (free key: ${KEY_PAGES.openrouter}).`
    case "provider.no-route":
      return "No connected provider can serve the selected model. Run \"orbit auth login\" to connect one, or pick a different model."
    case "provider.transport":
      return "Orbit could not reach the model provider. Check your internet connection, then try again — nothing was lost."
    case "provider.rate-limit":
      return "The provider is throttling requests right now. Orbit retries automatically; if this keeps happening, a backup model keeps the task moving."
    default:
      return undefined
  }
}

/** Advice shown when a model runs out and no backup is configured. */
export const NO_BACKUP =
  `No backup model is set up. Add one with "orbit auth login openrouter" (free models), or pick another model with /model.`
