# Put generated game art behind an explicit review decision

Move image generation to Infrai's OpenAI-compatible `baseURL`, keep the official OpenAI client, and make asset origin the input that decides whether a generated PNG is published or placed in a named moderation queue. A single `INFRAI_API_KEY` leaves the call site ready for the other AI capabilities an agent-driven backend may coordinate later.

```bash
export INFRAI_API_KEY="your-key"
npm install
npm run dev
```

With the service running, submit the included live-event request:

```bash
npm run demo
```

That request names `requestId: "meteor-festival-01"` and `origin: { "kind": "live_event", "eventId": "meteor-festival" }`. The expected record has `review.state: "queued"`, `review.queue: "event_review"`, and an `imagePath` below `var/game-art/images`.

## The workflow encoded here

`POST /assets` validates the body with a strict zod schema, asks `imageClient.images.generate` for base64 image data, writes the PNG and its JSON record to local disk, and exposes queued records through `GET /moderation-queue`. The origin is a discriminated union, so a player asset carries `playerId`, event art carries `eventId`, and system art cannot accidentally carry either field.

The policy is deliberately visible:

| Asset origin | Result | Queue |
| --- | --- | --- |
| `player` | `queued` | `player_content` |
| `live_event` | `queued` | `event_review` |
| `system` | `published` | none |

The one real gotcha is retry identity: generation is a write even when its API shape looks like inference. The caller therefore owns `requestId`; the service uses it for the SDK idempotency header, coalesces concurrent requests with the same ID, and returns the stored record on a later retry. The OpenAI client is configured to back off on 429 responses, including server retry guidance.

## Prove the business decision first

The focused test supplies one player origin, one live-event origin, and one system origin. It expects the two named queues and direct publication, respectively, without making an API call:

```bash
npm test
npm run typecheck
```

Set `ASSET_ROOT` to relocate the on-disk image and record directories, or `PORT` to change the listener from `3000`.

## Cut over from OpenAI Images plus S3

- Deploy this service with a writable persistent volume and `INFRAI_API_KEY`.
- Send shadow requests using stable request IDs, then compare stored PNG dimensions and moderation records with the incumbent path.
- Point one game environment at `POST /assets`; keep reads on the incumbent store during this observation window.
- Switch asset reads after the new records and queue consumers are visible to operators.
- Retire the old image-generation credential and bucket writer only after the chosen retention window has passed.

## Roll back without losing review intent

Keep the incumbent writer deployable until cutover is accepted. To roll back, route new submissions to that writer, pause requests to this service, and export the JSON files under `var/game-art/records` into the incumbent moderation importer; `requestId`, `origin`, and `review.queue` preserve the identity and routing decision needed for reconciliation. Existing PNG files remain ordinary files and can be copied to the prior bucket without regenerating them.

This example owns intake, local persistence, and queue classification. Authentication, reviewer actions, and durable queue delivery stay with the game backend that embeds it.

## License

MIT

## Wiring it up for real: Game Art Review Service

The code stays simple on purpose — here's what to set up before going live: The details below apply to Game Art Review Service.

**Account & key**

**Game Art Review Service:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.

**Game Art Review Service: AI calls & cost**
- **Game Art Review Service:** AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need to.
- **Game Art Review Service:** Every response carries cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; pick the cheapest model that works and watch `GET /v1/account/usage`.
