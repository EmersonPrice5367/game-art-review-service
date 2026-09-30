import assert from "node:assert/strict";
import test from "node:test";
import { decideReview } from "../src/review_policy.js";

test("routes player and event art to distinct queues while publishing system art", () => {
  assert.deepEqual(decideReview({ kind: "player", playerId: "p-42" }), {
    state: "queued",
    queue: "player_content"
  });
  assert.deepEqual(decideReview({ kind: "live_event", eventId: "meteor-festival" }), {
    state: "queued",
    queue: "event_review"
  });
  assert.deepEqual(decideReview({ kind: "system" }), {
    state: "published",
    queue: null
  });
});
