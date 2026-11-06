export * as ConfigFallback from "./fallback.js"

import { Schema } from "effect"
import { optional, PositiveInt } from "../schema.js"
import { ConfigModel } from "./model.js"

export class Info extends Schema.Class<Info>("Config.Fallback")({
  mode: Schema.Literals(["ask", "always", "never"])
    .pipe(optional)
    .annotate({
      description:
        'What to do when the current model runs out of rate limit or quota: "always" switches immediately, "ask" switches after the first confirmed need and remembers the answer, "never" stops with an error (default: "ask"). Headless runs treat "ask" as "always".',
    }),
  models: Schema.Array(ConfigModel.Selection)
    .pipe(optional)
    .annotate({
      description:
        'Models to try in order when the current one stops working, e.g. ["openrouter/openrouter/free"] (default: the built-in backup list).',
    }),
  threshold: PositiveInt.pipe(optional).annotate({
    description:
      "How many failed attempts on one model a rate limit must produce before switching (default: 3). A single 429 always retries first; quota errors that report a hard cap switch on the first attempt.",
  }),
  resetAfter: Schema.DurationFromString.pipe(optional).annotate({
    description:
      'How long to stay on a backup when the provider does not say when the limit resets (default: "1 hour").',
  }),
  maxSwitches: PositiveInt.pipe(optional).annotate({
    description: "Maximum model switches per turn, so a chain of failing backups cannot loop (default: 3).",
  }),
}) {}
