/**
 * Free local AI via Ollama. Falls back if Ollama is unavailable.
 * Never invent facts outside the provided evidence.
 */
export type AiResult = {
  ok: boolean;
  text: string;
  provider: "ollama" | "fallback";
  model: string | null;
  error?: string;
};

const HOST = (process.env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/\/$/, "");
const MODEL = process.env.OLLAMA_MODEL || "qwen2.5-coder:3b";
const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 90000);

export async function available(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch(`${HOST}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

export async function complete(opts: {
  system: string;
  user: string;
  temperature?: number;
}): Promise<AiResult> {
  if (!(await available())) {
    return {
      ok: false,
      text: "",
      provider: "fallback",
      model: null,
      error: "ollama_unavailable",
    };
  }

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(`${HOST}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        options: { temperature: opts.temperature ?? 0.1 },
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      }),
    });
    clearTimeout(t);
    if (!res.ok) {
      return {
        ok: false,
        text: "",
        provider: "fallback",
        model: MODEL,
        error: `http_${res.status}`,
      };
    }
    const data = (await res.json()) as { message?: { content?: string } };
    const text = (data.message?.content || "").trim();
    return { ok: Boolean(text), text, provider: "ollama", model: MODEL };
  } catch (e) {
    return {
      ok: false,
      text: "",
      provider: "fallback",
      model: MODEL,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function groundedComplete(opts: {
  task: string;
  evidence: string;
  question?: string;
}): Promise<AiResult> {
  const system =
    "You are a senior software engineer assistant. " +
    "Use ONLY the EVIDENCE block. If evidence is insufficient, say so clearly. " +
    "Do not invent files, APIs, tests, or causes not present in evidence. " +
    "Be concise and technical.";
  let user = `TASK:\n${opts.task}\n\nEVIDENCE:\n${opts.evidence}\n`;
  if (opts.question) user += `\nQUESTION:\n${opts.question}\n`;
  return complete({ system, user });
}
