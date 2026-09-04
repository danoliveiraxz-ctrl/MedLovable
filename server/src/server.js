import http from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.PORT || 8787);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-6-astra";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const ACCESS_TOKEN = process.env.MEDLOVABLE_ACCESS_TOKEN;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "chrome-extension://";
const plans = new Map();

const EDITABLE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".css", ".scss", ".html", ".json", ".md", ".toml", ".yaml", ".yml"]);
const PROTECTED_PATHS = [".git/", ".github/workflows/", "node_modules/", "dist/", "build/", ".env"];
const MAX_BODY_BYTES = 80_000;
const MAX_CONTEXT_BYTES = 180_000;
const PLAN_TTL_MS = 30 * 60 * 1000;

function json(response, status, payload, origin = "*") {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function allowedOrigin(origin) {
  if (!origin) return "*";
  if (ALLOWED_ORIGIN === "*") return "*";
  if (ALLOWED_ORIGIN === "chrome-extension://" && origin.startsWith("chrome-extension://")) return origin;
  return origin === ALLOWED_ORIGIN ? origin : null;
}

function authorized(request) {
  if (!ACCESS_TOKEN) return false;
  const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, "") || "";
  const expectedBuffer = Buffer.from(ACCESS_TOKEN);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new HttpError(413, "Solicitação muito grande.");
  }
  try { return JSON.parse(body || "{}"); } catch { throw new HttpError(400, "JSON inválido."); }
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function assertConfiguration() {
  const missing = [!OPENAI_API_KEY && "OPENAI_API_KEY", !GITHUB_TOKEN && "GITHUB_TOKEN", !ACCESS_TOKEN && "MEDLOVABLE_ACCESS_TOKEN"].filter(Boolean);
  if (missing.length) throw new HttpError(503, `Servidor não configurado: ${missing.join(", ")}.`);
}

function validateTarget(repository, branch) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || "")) throw new HttpError(400, "Repositório inválido.");
  if (!/^[\w./-]+$/.test(branch || "") || branch.includes("..")) throw new HttpError(400, "Branch inválida.");
}

function isSafePath(path) {
  if (!path || path.startsWith("/") || path.includes("..") || path.includes("\\")) return false;
  if (PROTECTED_PATHS.some((item) => path === item || path.startsWith(item))) return false;
  const dot = path.lastIndexOf(".");
  return dot >= 0 && EDITABLE_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

async function github(path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "MedLovable/0.1",
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpError(response.status, data.message || "Erro ao acessar o GitHub.");
  return data;
}

function extension(path) {
  const match = path.match(/(\.[a-z0-9]+)$/i);
  return match?.[1].toLowerCase() || "";
}

function filePriority(path) {
  let score = 0;
  if (/AGENTS\.md$/i.test(path)) score += 100;
  if (/package\.json$|vite\.config|README\.md$/i.test(path)) score += 40;
  if (/src\/(routes|pages|app)|App\.[jt]sx?|index\.[jt]sx?/i.test(path)) score += 35;
  if (/components|styles?|\.css$/i.test(path)) score += 25;
  score -= path.split("/").length;
  return score;
}

async function repositoryContext(repository, branch) {
  const [owner, name] = repository.split("/");
  const encodedBranch = encodeURIComponent(branch);
  const ref = await github(`/repos/${owner}/${name}/git/ref/heads/${encodedBranch}`);
  const baseSha = ref.object.sha;
  const commit = await github(`/repos/${owner}/${name}/git/commits/${baseSha}`);
  const tree = await github(`/repos/${owner}/${name}/git/trees/${commit.tree.sha}?recursive=1`);
  if (tree.truncated) throw new HttpError(413, "O repositório é grande demais para esta versão do MedLovable.");

  const candidates = tree.tree
    .filter((item) => item.type === "blob" && item.size <= 80_000 && isSafePath(item.path))
    .filter((item) => !/lock\.(json|yaml)$|\.lock$|routeTree\.gen/i.test(item.path))
    .sort((a, b) => filePriority(b.path) - filePriority(a.path));

  const files = [];
  let total = 0;
  for (const item of candidates) {
    if (files.length >= 24 || total >= MAX_CONTEXT_BYTES) break;
    const blob = await github(`/repos/${owner}/${name}/git/blobs/${item.sha}`);
    const content = Buffer.from(blob.content.replace(/\n/g, ""), blob.encoding).toString("utf8");
    if (content.includes("\u0000")) continue;
    const remaining = MAX_CONTEXT_BYTES - total;
    const clipped = content.slice(0, remaining);
    files.push({ path: item.path, content: clipped });
    total += Buffer.byteLength(clipped);
  }

  return { owner, name, baseSha, baseTreeSha: commit.tree.sha, files, tree: candidates.map((item) => item.path) };
}

const changeSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    edits: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
          reason: { type: "string" },
        },
        required: ["path", "content", "reason"],
        additionalProperties: false,
      },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "edits", "warnings"],
  additionalProperties: false,
};

function outputText(response) {
  return (response.output || [])
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text)
    .join("");
}

async function createPlan(body) {
  const { repository, branch = "main", instruction, history = [], page = null } = body;
  validateTarget(repository, branch);
  if (typeof instruction !== "string" || instruction.trim().length < 8 || instruction.length > 4000) throw new HttpError(400, "Instrução inválida.");

  const context = await repositoryContext(repository, branch);
  const fileText = context.files.map((file) => `\n--- FILE: ${file.path} ---\n${file.content}`).join("\n");
  const system = `Você é o engenheiro do MedLovable. Edite projetos web do GitHub conectados ao Lovable. Responda em português. Retorne arquivos UTF-8 completos, nunca diffs. Preserve histórico Git, integrações, conteúdo não relacionado e instruções de AGENTS.md. Não inclua segredos, binários, lockfiles, workflows ou arquivos gerados. Crie no máximo 8 arquivos. Priorize um resultado visual completo, responsivo e funcional. Se faltar informação, use placeholders fáceis de trocar e registre um aviso.`;
  const previous = history.slice(-8).map((item) => `${item.role}: ${String(item.content).slice(0, 800)}`).join("\n");
  const user = `REPOSITÓRIO: ${repository}\nBRANCH: ${branch}\nPÁGINA ATUAL: ${page?.url || "não informada"}\nINSTRUÇÃO: ${instruction}\nHISTÓRICO RECENTE:\n${previous || "sem histórico"}\n\nÁRVORE DE ARQUIVOS:\n${context.tree.join("\n")}\n\nCONTEÚDO DISPONÍVEL:${fileText}`;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [{ role: "system", content: system }, { role: "user", content: user }],
      text: { format: { type: "json_schema", name: "repository_change", strict: true, schema: changeSchema } },
    }),
  });
  const openai = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpError(response.status, openai.error?.message || "A OpenAI não conseguiu gerar a alteração.");
  const raw = outputText(openai);
  if (!raw) throw new HttpError(502, "A OpenAI não retornou uma proposta utilizável.");

  let proposal;
  try { proposal = JSON.parse(raw); } catch { throw new HttpError(502, "A proposta retornada não é um JSON válido."); }
  if (!Array.isArray(proposal.edits) || !proposal.edits.length) throw new HttpError(422, "Nenhuma alteração foi proposta.");
  for (const edit of proposal.edits) {
    if (!isSafePath(edit.path)) throw new HttpError(422, `Arquivo bloqueado na proposta: ${edit.path}`);
    if (typeof edit.content !== "string" || Buffer.byteLength(edit.content) > 250_000) throw new HttpError(422, `Conteúdo inválido: ${edit.path}`);
  }

  const planId = randomUUID();
  plans.set(planId, { ...proposal, repository, branch, owner: context.owner, name: context.name, baseSha: context.baseSha, baseTreeSha: context.baseTreeSha, createdAt: Date.now() });
  return { planId, summary: proposal.summary, edits: proposal.edits.map(({ path, reason }) => ({ path, reason })), warnings: proposal.warnings, expiresInMinutes: 30 };
}

async function applyPlan(planId) {
  const plan = plans.get(planId);
  if (!plan || Date.now() - plan.createdAt > PLAN_TTL_MS) throw new HttpError(404, "Plano inexistente ou expirado. Analise novamente.");
  const { owner, name, branch } = plan;
  const currentRef = await github(`/repos/${owner}/${name}/git/ref/heads/${encodeURIComponent(branch)}`);
  if (currentRef.object.sha !== plan.baseSha) throw new HttpError(409, "A branch mudou depois da análise. Gere um novo plano antes de aplicar.");

  const treeItems = [];
  for (const edit of plan.edits) {
    const blob = await github(`/repos/${owner}/${name}/git/blobs`, { method: "POST", body: JSON.stringify({ content: edit.content, encoding: "utf-8" }) });
    treeItems.push({ path: edit.path, mode: "100644", type: "blob", sha: blob.sha });
  }
  const tree = await github(`/repos/${owner}/${name}/git/trees`, { method: "POST", body: JSON.stringify({ base_tree: plan.baseTreeSha, tree: treeItems }) });
  const commit = await github(`/repos/${owner}/${name}/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message: `MedLovable: ${plan.summary.slice(0, 120)}`, tree: tree.sha, parents: [plan.baseSha] }),
  });
  await github(`/repos/${owner}/${name}/git/refs/heads/${encodeURIComponent(branch)}`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false }) });
  plans.delete(planId);
  return { commitSha: commit.sha, commitUrl: `https://github.com/${owner}/${name}/commit/${commit.sha}` };
}

setInterval(() => {
  const now = Date.now();
  for (const [id, plan] of plans) if (now - plan.createdAt > PLAN_TTL_MS) plans.delete(id);
}, 5 * 60 * 1000).unref();

const server = http.createServer(async (request, response) => {
  const origin = allowedOrigin(request.headers.origin);
  if (!origin) return json(response, 403, { error: "Origem não autorizada." });
  if (request.method === "OPTIONS") return json(response, 204, {}, origin);

  try {
    if (request.method === "GET" && request.url === "/health") return json(response, 200, { ok: true, service: "MedLovable", model: OPENAI_MODEL }, origin);
    if (!authorized(request)) throw new HttpError(401, "Senha de acesso inválida.");
    assertConfiguration();
    if (request.method === "POST" && request.url === "/api/plan") return json(response, 200, await createPlan(await readBody(request)), origin);
    if (request.method === "POST" && request.url === "/api/apply") {
      const { planId } = await readBody(request);
      return json(response, 200, await applyPlan(planId), origin);
    }
    throw new HttpError(404, "Rota não encontrada.");
  } catch (error) {
    console.error(error);
    json(response, error.status || 500, { error: error.status ? error.message : "Erro interno do servidor." }, origin);
  }
});

server.listen(PORT, () => console.log(`MedLovable disponível em http://localhost:${PORT}`));

