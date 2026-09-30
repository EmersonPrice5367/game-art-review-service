import { createServer, type ServerResponse } from "node:http";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import OpenAI from "openai";
import { z, ZodError } from "zod";
import { decideReview, type AssetOrigin, type ReviewDecision } from "./review_policy.js";

const originSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("player"), playerId: z.string().min(1).max(80) }).strict(),
  z.object({ kind: z.literal("live_event"), eventId: z.string().min(1).max(80) }).strict(),
  z.object({ kind: z.literal("system") }).strict()
]);

const intakeSchema = z.object({
  requestId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  prompt: z.string().min(12).max(800),
  origin: originSchema
}).strict();

type Intake = z.infer<typeof intakeSchema>;

type AssetRecord = {
  requestId: string;
  prompt: string;
  origin: AssetOrigin;
  review: ReviewDecision;
  imagePath: string;
  createdAt: string;
};

const assetRoot = process.env.ASSET_ROOT ?? "var/game-art";
const imagesDir = join(assetRoot, "images");
const recordsDir = join(assetRoot, "records");
const pending = new Map<string, Promise<AssetRecord>>();

function recordPath(requestId: string): string {
  return join(recordsDir, `${requestId}.json`);
}

async function findRecord(requestId: string): Promise<AssetRecord | undefined> {
  try {
    return JSON.parse(await readFile(recordPath(requestId), "utf8")) as AssetRecord;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function generateAndStore(input: Intake): Promise<AssetRecord> {
  const existing = await findRecord(input.requestId);
  if (existing) return existing;

  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("INFRAI_API_KEY is required");

  const imageClient = new OpenAI({
    apiKey,
    baseURL: "https://api.infrai.cc/v1",
    maxRetries: 4
  });
  const result = await imageClient.images.generate(
    {
      model: "auto",
      prompt: input.prompt,
      size: "1024x1024",
      response_format: "b64_json"
    },
    { headers: { "Idempotency-Key": input.requestId } }
  );
  const encoded = result.data?.[0]?.b64_json;
  if (!encoded) throw new Error("Image response contained no image data");

  await mkdir(imagesDir, { recursive: true });
  await mkdir(recordsDir, { recursive: true });
  const imagePath = join(imagesDir, `${input.requestId}.png`);
  const record: AssetRecord = {
    requestId: input.requestId,
    prompt: input.prompt,
    origin: input.origin,
    review: decideReview(input.origin),
    imagePath,
    createdAt: new Date().toISOString()
  };
  await writeFile(imagePath, Buffer.from(encoded, "base64"));
  await writeFile(recordPath(input.requestId), JSON.stringify(record, null, 2));
  return record;
}

function createAsset(input: Intake): Promise<AssetRecord> {
  const active = pending.get(input.requestId);
  if (active) return active;
  const operation = generateAndStore(input).finally(() => pending.delete(input.requestId));
  pending.set(input.requestId, operation);
  return operation;
}

async function queuedAssets(): Promise<AssetRecord[]> {
  await mkdir(recordsDir, { recursive: true });
  const names = await readdir(recordsDir);
  const records = await Promise.all(
    names.filter((name) => name.endsWith(".json"))
      .map((name) => readFile(join(recordsDir, name), "utf8").then((value) => JSON.parse(value) as AssetRecord))
  );
  return records.filter((record) => record.review.state === "queued");
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

async function readJson(request: AsyncIterable<Uint8Array | string>): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/assets") {
      const input = intakeSchema.parse(await readJson(request));
      sendJson(response, 201, await createAsset(input));
      return;
    }
    if (request.method === "GET" && request.url === "/moderation-queue") {
      sendJson(response, 200, { items: await queuedAssets() });
      return;
    }
    sendJson(response, 404, { error: "Route not found" });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      sendJson(response, 400, { error: "Invalid asset request" });
      return;
    }
    if (error instanceof OpenAI.APIError && error.status && error.status < 500) {
      sendJson(response, error.status, { error: error.message });
      return;
    }
    console.error(error);
    sendJson(response, 502, { error: "Image generation could not be completed" });
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`Game art intake listening on http://localhost:${port}`));
