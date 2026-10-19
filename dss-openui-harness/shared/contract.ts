// Zod schemas for the DSS Turn API v1, hand-written from
// decision-support-system/docs/api-contracts/openapi.yaml.
// Request objects are closed (additionalProperties: false in the spec).
// Response schemas are also strict here so the tests catch anything the mock
// adds that the contract does not define.
import { z } from "zod/v4";

// ---------- request ----------

const LanguageTag = z.string().min(1);

const GeoJsonPoint = z
  .object({
    type: z.literal("Point"),
    // GeoJSON order: [longitude, latitude]
    coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
  })
  .strict();

const Location = z
  .object({
    region: z.string().nullable().optional(),
    area: z.string().nullable().optional(),
    geometry: GeoJsonPoint.optional(),
  })
  .strict();

export const RequestAttributes = z
  .object({
    sourceLanguage: LanguageTag,
    targetLanguage: LanguageTag,
    channel: z.enum(["web", "whatsapp", "voice", "sms"]),
    location: Location.optional(),
    response: z.object({ maxCharacters: z.number().int().min(1).optional() }).strict().optional(),
  })
  .strict();

export const ImageAttachment = z
  .object({
    url: z.url(),
    mediaType: z.enum(["image/jpeg", "image/png"]),
    sha256: z.string().regex(/^[0-9a-f]{64}$/, "sha256 must be 64 lowercase hex characters"),
  })
  .strict();

const InputText = z.object({ type: z.literal("text"), text: z.string() }).strict();
const InputImage = z.object({ type: z.literal("image"), attachment: ImageAttachment }).strict();
export const InputContentItem = z.discriminatedUnion("type", [InputText, InputImage]);

export const InputMessage = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.array(InputContentItem).min(1),
  })
  .strict();

const IdentityFact = z.object({ type: z.literal("identity"), userId: z.string() }).strict();

export const RequestContext = z
  .object({
    id: z.literal("api.dss.turn"),
    version: z.string().optional(),
    transactionId: z.uuid(),
    messageId: z.string().optional(),
    timestamp: z.iso.datetime({ offset: true }),
    sessionId: z.string().min(1),
  })
  .strict();

export const TurnRequest = z
  .object({
    context: RequestContext,
    message: z
      .object({
        userContext: z.array(IdentityFact).optional(),
        input: z.array(InputMessage).min(1),
        attributes: RequestAttributes,
      })
      .strict(),
  })
  .strict();

export type TurnRequest = z.infer<typeof TurnRequest>;
export type InputMessage = z.infer<typeof InputMessage>;
export type ImageAttachment = z.infer<typeof ImageAttachment>;
export type RequestAttributes = z.infer<typeof RequestAttributes>;

// ---------- response ----------

export const OutcomeStatus = z.enum([
  "answered",
  "rejected",
  "no_match",
  "requires_input",
  "unavailable",
  "partially_answered",
]);

export const Outcome = z
  .object({
    status: OutcomeStatus,
    cause: z.string().nullable(),
    confidence: z.number().int().min(0).max(100),
  })
  .strict();

const Annotation = z
  .object({
    type: z.literal("url_citation"),
    url: z.url().optional(),
    sourceId: z.string(),
    sourceName: z.string().optional(),
    startIndex: z.number().int().min(0),
    endIndex: z.number().int().min(0),
  })
  .strict();

export const OutputText = z
  .object({ type: z.literal("text"), text: z.string(), annotations: z.array(Annotation).optional() })
  .strict();
export const OutputTextDelta = z.object({ type: z.literal("output_text_delta"), text: z.string() }).strict();
export const OutputRefusal = z.object({ type: z.literal("refusal"), text: z.string() }).strict();
export const OutputContentItem = z.discriminatedUnion("type", [OutputText, OutputTextDelta, OutputRefusal]);

export const Source = z.object({ id: z.string(), name: z.string(), kind: z.string() }).strict();

export const TurnError = z
  .object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
    retryAfterSeconds: z.number().int().min(0).optional(),
  })
  .strict();

export const ResponseContext = z
  .object({
    id: z.literal("api.dss.turn"),
    version: z.string().min(1),
    timestamp: z.iso.datetime({ offset: true }),
    messageId: z.string().min(1),
    sessionId: z.string().min(1),
    traceId: z.string().regex(/^[0-9a-f]{32}$/),
  })
  .strict();

export const ResponseMessage = z
  .object({
    outcome: Outcome,
    content: z.array(z.discriminatedUnion("type", [OutputText, OutputRefusal])),
    sources: z.array(Source).optional(),
    error: TurnError.optional(),
  })
  .strict();

export const TurnResponse = z.object({ context: ResponseContext, message: ResponseMessage }).strict();

export const EventContext = ResponseContext.extend({ sequenceNumber: z.number().int().min(1) }).strict();

export const TurnEvent = z
  .object({
    context: EventContext,
    message: z
      .object({
        outcome: Outcome.optional(),
        content: z.array(OutputContentItem).optional(),
        sources: z.array(Source).optional(),
        error: TurnError.optional(),
      })
      .strict(),
  })
  .strict();

export type Outcome = z.infer<typeof Outcome>;
export type OutputContentItem = z.infer<typeof OutputContentItem>;
export type ResponseContent = z.infer<typeof ResponseMessage>["content"][number];
export type TurnResponse = z.infer<typeof TurnResponse>;
export type TurnEvent = z.infer<typeof TurnEvent>;
export type TurnError = z.infer<typeof TurnError>;
export type Source = z.infer<typeof Source>;

export const SSE_EVENTS = ["turn.created", "claim.delta", "claim.completed", "turn.completed", "turn.failed"] as const;
export type SseEventName = (typeof SSE_EVENTS)[number];
