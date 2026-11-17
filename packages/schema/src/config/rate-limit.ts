export * as ConfigRateLimit from "./rate-limit.js"

import { Schema } from "effect"
import { NonNegativeInt, optional } from "../schema.js"

/**
 * One rolling-minute budget. Both fields are optional and enforced independently: a request waits
 * when either meter is full, so leaving one out only disables that meter.
 */
export class Budget extends Schema.Class<Budget>("Config.RateLimit.Budget")({
  requestsPerMinute: NonNegativeInt.pipe(optional).annotate({
    description: "Requests this model accepts in a rolling minute, such as 15 on a free tier",
  }),
  inputTokensPerMinute: NonNegativeInt.pipe(optional).annotate({
    description: "Input tokens this model accepts in a rolling minute, such as 250000 on a free tier",
  }),
}) {}

export class Info extends Schema.Class<Info>("Config.RateLimit")({
  preset: Schema.Literals(["free"]).pipe(optional).annotate({
    description:
      'Apply known free-tier budgets, so free models wait for their own quota instead of being refused with a 429. Currently only "free" for Google Flash Lite.',
  }),
  models: Schema.Record(Schema.String, Budget).pipe(optional).annotate({
    description:
      'Per-model budgets keyed "<provider>/<model>", such as "google/gemini-3.5-flash-lite". A "*" entry applies to every model that has no entry of its own. Overrides the preset.',
  }),
}) {}
