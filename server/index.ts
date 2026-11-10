import express from "express";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import path from "node:path";
import {
  executeJudge0,
  Judge0AbortError,
  Judge0RequestError,
  validateRunInput,
} from "./judge0";

export const app = express();
export const server = createServer(app);
export const port = Number(process.env.PORT ?? 3001);
const judge0Url = process.env.JUDGE0_URL ?? "https://ce.judge0.com";
const judge0TimeoutMs = Number(process.env.JUDGE0_TIMEOUT_MS ?? 30_000);

app.use(express.json({ limit: "512kb" }));

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
  response.json({ ok: true, service: "console-backend" });
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
