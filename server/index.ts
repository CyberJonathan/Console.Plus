import express from "express";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import {
  executeJudge0,
  Judge0AbortError,
  Judge0RequestError,
  validateRunInput,
} from "./judge0.js";

export const app = express();
export const server = createServer(app);
export const port = Number(process.env.PORT ?? 3001);
const judge0Url = process.env.JUDGE0_URL ?? "https://ce.judge0.com";
const judge0TimeoutMs = Number(process.env.JUDGE0_TIMEOUT_MS ?? 30_000);
const signalingPath = "/signaling";
const signalingServer = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
const signalingTopics = new Map<string, Set<WebSocket>>();

app.use(express.json({ limit: "512kb" }));

server.on("upgrade", (request, socket, head) => {
  let pathname: string;
  try {
    pathname = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`).pathname;
  } catch {
    socket.destroy();
    return;
  }
  if (pathname !== signalingPath) {
    socket.destroy();
    return;
  }

  signalingServer.handleUpgrade(request, socket, head, (websocket) => {
    signalingServer.emit("connection", websocket, request);
  });
});

signalingServer.on("connection", (websocket) => {
  const subscribedTopics = new Set<string>();
  let isAlive = true;
  const heartbeat = setInterval(() => {
    if (!isAlive) {
      websocket.terminate();
      return;
    }
    isAlive = false;
    websocket.ping();
  }, 30_000);
  heartbeat.unref();

  websocket.on("pong", () => {
    isAlive = true;
  });
  websocket.on("close", () => {
    clearInterval(heartbeat);
    for (const topicName of subscribedTopics) {
      const subscribers = signalingTopics.get(topicName);
      subscribers?.delete(websocket);
      if (subscribers?.size === 0) signalingTopics.delete(topicName);
    }
  });
  websocket.on("error", (error) => {
    console.error("Erro na conexão WebSocket de signaling:", error);
  });
  websocket.on("message", (data) => {
    let message: unknown;
    try {
      const text = Buffer.isBuffer(data)
        ? data.toString("utf8")
        : data instanceof ArrayBuffer
          ? Buffer.from(data).toString("utf8")
          : Buffer.concat(data).toString("utf8");
      message = JSON.parse(text);
    } catch {
      websocket.close(1007, "Mensagem JSON inválida");
      return;
    }

    if (!message || typeof message !== "object" || !("type" in message)) {
      websocket.close(1008, "Mensagem signaling inválida");
      return;
    }

    const payload = message as Record<string, unknown>;
    if (payload.type === "subscribe" || payload.type === "unsubscribe") {
      const topics = Array.isArray(payload.topics)
        ? payload.topics.filter(
          (topic): topic is string => typeof topic === "string" && topic.length > 0 && topic.length <= 256,
        )
        : [];
      for (const topicName of topics) {
        if (payload.type === "subscribe") {
          const subscribers = signalingTopics.get(topicName) ?? new Set<WebSocket>();
          subscribers.add(websocket);
          signalingTopics.set(topicName, subscribers);
          subscribedTopics.add(topicName);
        } else {
          signalingTopics.get(topicName)?.delete(websocket);
          if (signalingTopics.get(topicName)?.size === 0) signalingTopics.delete(topicName);
          subscribedTopics.delete(topicName);
        }
      }
      return;
    }

    if (
      payload.type === "publish" &&
      typeof payload.topic === "string" &&
      payload.topic.length > 0 &&
      payload.topic.length <= 256
    ) {
      const subscribers = signalingTopics.get(payload.topic);
      if (!subscribers) return;
      const relayMessage = JSON.stringify({ ...payload, clients: subscribers.size });
      for (const subscriber of subscribers) {
        if (subscriber.readyState === WebSocket.OPEN) subscriber.send(relayMessage);
      }
      return;
    }

    if (payload.type === "ping") {
      websocket.send(JSON.stringify({ type: "pong" }));
    }
  });
});

app.post("/api/run", async (request, response) => {
  const validation = validateRunInput(request.body);
  if (!validation.input) {
    response.status(400).json({ error: validation.error });
    return;
  }

  const abortController = new AbortController();
  response.on("close", () => {
    if (!response.writableEnded) abortController.abort();
  });

  try {
    const result = await executeJudge0(validation.input, {
      judge0Url,
      timeoutMs: judge0TimeoutMs,
      authToken: process.env.JUDGE0_AUTH_TOKEN,
      signal: abortController.signal,
    });
    response.status(200).json(result);
  } catch (error) {
    if (error instanceof Judge0AbortError) return;
    if (error instanceof Judge0RequestError) {
      response.status(error.statusCode).json({
        error: error.message,
        ...(error.details ? { details: error.details } : {}),
      });
      return;
    }
    console.error("Falha inesperada na execução:", error);
    response.status(502).json({ error: "Falha inesperada ao executar o programa." });
  }
});

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, service: "console-backend", signaling: signalingPath });
});

app.get("/", (_request, response) => {
  response.sendFile(path.join(process.cwd(), "index.html"));
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`A porta ${port} já está em uso. Encerre o backend existente ou use PORT=outra_porta.`);
    process.exitCode = 1;
    return;
  }
  console.error("Erro ao iniciar o backend:", error);
  process.exitCode = 1;
});

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  server.listen(port, () => {
    console.log(`Backend disponível em http://localhost:${port}`);
  });
}
