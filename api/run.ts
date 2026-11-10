import {
  executeJudge0,
  Judge0AbortError,
  Judge0RequestError,
  validateRunInput,
} from "../server/judge0";

interface VercelRequest {
  method?: string;
  body?: unknown;
  on?(event: "aborted", listener: () => void): void;
}

interface VercelResponse {
  status(code: number): VercelResponse;
  json(body: unknown): VercelResponse;
  end(): void;
  on?(event: "close", listener: () => void): void;
}

const judge0Url = process.env.JUDGE0_URL ?? "https://ce.judge0.com";
const configuredTimeout = Number(process.env.JUDGE0_TIMEOUT_MS ?? 8_000);
const judge0TimeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
  ? Math.min(configuredTimeout, 8_000)
  : 8_000;

export default async function handler(request: VercelRequest, response: VercelResponse): Promise<void> {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Use o método POST." });
    return;
  }

  const validation = validateRunInput(request.body);
  if (!validation.input) {
    response.status(400).json({ error: validation.error });
    return;
  }

  const abortController = new AbortController();
  request.on?.("aborted", () => abortController.abort());
  response.on?.("close", () => abortController.abort());

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
}
