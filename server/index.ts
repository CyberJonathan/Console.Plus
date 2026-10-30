import express from "express";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import path from "node:path";

export const app = express();
export const server = createServer(app);
export const port = Number(process.env.PORT ?? 3001);
const judge0Url = process.env.JUDGE0_URL ?? "https://ce.judge0.com";
const judge0TimeoutMs = Number(process.env.JUDGE0_TIMEOUT_MS ?? 30_000);

app.use(express.json({ limit: "64kb" }));

function encodeJudge0Value(value: string) {
  return Buffer.from(value, "utf8").toString("base64");
}

function decodeJudge0Result(result: Record<string, unknown>) {
  for (const field of ["stdout", "stderr", "compile_output", "message"]) {
    if (typeof result[field] === "string") {
      result[field] = Buffer.from(result[field], "base64").toString("utf8");
    }
  }
  return result;
}

function parseLanguageId(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  throw new Error("languageId deve ser um número inteiro positivo.");
}

app.post("/api/run", async (request, response) => {
  const body = request.body as {
    sourceCode?: unknown;
    languageId?: unknown;
    stdin?: unknown;
  };

  const { sourceCode, stdin = "" } = body;

  if (typeof sourceCode !== "string" || sourceCode.length === 0 || sourceCode.length > 100_000) {
    response.status(400).json({ error: "sourceCode deve ser um texto de até 100 KB e não vazio." });
    return;
  }

  if (typeof stdin !== "string") {
    response.status(400).json({ error: "stdin deve ser uma string." });
    return;
  }

  let languageId: number;
  try {
    languageId = parseLanguageId(body.languageId ?? 50);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "languageId inválido." });
    return;
  }

  try {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), judge0TimeoutMs);
    const submission = await fetch(
      `${judge0Url}/submissions?base64_encoded=true&wait=true`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source_code: encodeJudge0Value(sourceCode),
          language_id: languageId,
          stdin: encodeJudge0Value(stdin),
        }),
        signal: abortController.signal,
      },
    );
    clearTimeout(timeout);

    if (!submission.ok) {
      const details = await submission.text();
      console.error(`Judge0 respondeu ${submission.status}:`, details);
      response.status(submission.status).json({
        error: "O serviço Judge0 recusou a execução.",
        details: details || "O Judge0 não informou detalhes.",
      });
      return;
    }

    const result = (await submission.json()) as Record<string, unknown>;
    response.status(200).json(decodeJudge0Result(result));
  } catch (error) {
    console.error("Judge0 indisponível:", error);
    if (error instanceof Error && error.name === "AbortError") {
      response.status(504).json({
        error: "O Judge0 demorou mais que o limite para responder.",
        details: `Limite configurado: ${judge0TimeoutMs} ms.`,
      });
      return;
    }
    response.status(502).json({ error: "Não foi possível conectar ao Judge0." });
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
