export type AssetOrigin =
  | { kind: "player"; playerId: string }
  | { kind: "live_event"; eventId: string }
  | { kind: "system" };

export type ReviewDecision =
  | { state: "queued"; queue: "player_content" | "event_review" }
  | { state: "published"; queue: null };

export function decideReview(origin: AssetOrigin): ReviewDecision {
  switch (origin.kind) {
    case "player":
      return { state: "queued", queue: "player_content" };
    case "live_event":
      return { state: "queued", queue: "event_review" };
    case "system":
      return { state: "published", queue: null };
  }
}
