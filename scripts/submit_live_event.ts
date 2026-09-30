const response = await fetch("http://localhost:3000/assets", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    requestId: "meteor-festival-01",
    prompt: "A luminous meteor festival banner in a colorful cooperative fantasy game",
    origin: { kind: "live_event", eventId: "meteor-festival" }
  })
});

const body: unknown = await response.json();
if (!response.ok) {
  throw new Error(`Asset submission failed (${response.status}): ${JSON.stringify(body)}`);
}

console.log(JSON.stringify(body, null, 2));
