interface VercelRequest {
  method?: string;
  body?: unknown;
}

interface VercelResponse {
  status(code: number): VercelResponse;
  json(body: unknown): VercelResponse;
  end(): void;
}

interface RunRequestBody {
  sourceCode?: unknown;
  languageId?: unknown;
  stdin?: unknown;
}

const judge0Url = process.env.JUDGE0_URL ?? "https://ce.judge0.com";
const configuredTimeout = Number(process.env.JUDGE0_TIMEOUT_MS ?? 8_000);
const judge0TimeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
  ? Math.min(configuredTimeout, 8_000)
  : 8_000;

function encodeJudge0Value(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function decodeJudge0Result(result: Record<string, unknown>): Record<string, unknown> {
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

export default async function handler(request: VercelRequest, response: VercelResponse): Promise<void> {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Use o método POST." });
    return;
  }

  const body = (request.body ?? {}) as RunRequestBody;
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
    response.status(400).json({
      error: error instanceof Error ? error.message : "languageId inválido.",
    });
    return;
  }

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), judge0TimeoutMs);

  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const authToken = process.env.JUDGE0_AUTH_TOKEN;
    if (authToken) headers["X-Auth-Token"] = authToken;

    const submission = await fetch(
      `${judge0Url}/submissions?base64_encoded=true&wait=true`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          source_code: encodeJudge0Value(sourceCode),
          language_id: languageId,
          stdin: encodeJudge0Value(stdin),
        }),
        signal: abortController.signal,
      },
    );

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
  } finally {
    clearTimeout(timeout);
  }
}
