const elements = {
  settingsToggle: document.querySelector("#settingsToggle"),
  settingsPanel: document.querySelector("#settingsPanel"),
  backendUrl: document.querySelector("#backendUrl"),
  accessToken: document.querySelector("#accessToken"),
  saveSettings: document.querySelector("#saveSettings"),
  repository: document.querySelector("#repository"),
  branch: document.querySelector("#branch"),
  contextDot: document.querySelector("#contextDot"),
  contextLabel: document.querySelector("#contextLabel"),
  instruction: document.querySelector("#instruction"),
  charCount: document.querySelector("#charCount"),
  analyzeButton: document.querySelector("#analyzeButton"),
  resultPanel: document.querySelector("#resultPanel"),
  summary: document.querySelector("#summary"),
  warnings: document.querySelector("#warnings"),
  fileList: document.querySelector("#fileList"),
  planStatus: document.querySelector("#planStatus"),
  applyButton: document.querySelector("#applyButton"),
  activityPanel: document.querySelector("#activityPanel"),
  activityTitle: document.querySelector("#activityTitle"),
  activityText: document.querySelector("#activityText"),
  toast: document.querySelector("#toast"),
};

let activeContext = null;
let pendingPlanId = null;
let toastTimer = null;

async function loadSettings() {
  const { medlovableSettings = {} } = await chrome.storage.local.get("medlovableSettings");
  elements.backendUrl.value = medlovableSettings.backendUrl || "http://localhost:8787";
  elements.accessToken.value = medlovableSettings.accessToken || "";
}

async function saveSettings() {
  const medlovableSettings = {
    backendUrl: elements.backendUrl.value.trim().replace(/\/$/, ""),
    accessToken: elements.accessToken.value.trim(),
  };
  if (!medlovableSettings.backendUrl || !medlovableSettings.accessToken) {
    return showToast("Informe o backend e a senha de acesso.", true);
  }
  const backend = new URL(medlovableSettings.backendUrl);
  const originPattern = `${backend.origin}/*`;
  const granted = await chrome.permissions.request({ origins: [originPattern] });
  if (!granted) return showToast("Autorize o acesso ao endereço do backend.", true);
  await chrome.storage.local.set({ medlovableSettings });
  showToast("Conexão salva.");
  elements.settingsPanel.hidden = true;
}

function repositoryFromUrl(value) {
  const match = value?.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
  return match ? `${match[1]}/${match[2].replace(/\.git$/i, "")}` : null;
}

async function detectContext() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  try {
    activeContext = await chrome.tabs.sendMessage(tab.id, { type: "MEDLOVABLE_GET_CONTEXT" });
  } catch {
    activeContext = { repository: repositoryFromUrl(tab.url), url: tab.url, title: tab.title, source: "browser" };
  }

  if (activeContext?.repository) {
    elements.repository.value = activeContext.repository;
    elements.contextLabel.textContent = `Projeto detectado no ${activeContext.source === "github" ? "GitHub" : "Lovable"}`;
    elements.contextDot.classList.add("online");
  } else {
    elements.contextLabel.textContent = "Informe o repositório manualmente";
  }
}

function setBusy(active, title = "Analisando projeto", text = "Isso pode levar alguns instantes.") {
  elements.activityPanel.hidden = !active;
  elements.activityTitle.textContent = title;
  elements.activityText.textContent = text;
  elements.analyzeButton.disabled = active;
  elements.applyButton.disabled = active;
}

function showToast(message, error = false) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", error);
  elements.toast.hidden = false;
  toastTimer = setTimeout(() => { elements.toast.hidden = true; }, 4500);
}

async function api(path, body) {
  const backendUrl = elements.backendUrl.value.trim().replace(/\/$/, "");
  const accessToken = elements.accessToken.value.trim();
  if (!backendUrl || !accessToken) throw new Error("Abra as configurações e informe o backend e a senha de acesso.");

  const response = await fetch(`${backendUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Falha no servidor (${response.status}).`);
  return data;
}

async function getHistory(repository) {
  const key = `history:${repository}`;
  const result = await chrome.storage.local.get(key);
  return result[key] || [];
}

async function addHistory(repository, item) {
  const key = `history:${repository}`;
  const history = await getHistory(repository);
  history.push(item);
  await chrome.storage.local.set({ [key]: history.slice(-12) });
}

function renderPlan(plan) {
  pendingPlanId = plan.planId;
  elements.summary.textContent = plan.summary;
  elements.fileList.replaceChildren();
  for (const edit of plan.edits) {
    const item = document.createElement("div");
    item.className = "file-item";
    const path = document.createElement("strong");
    path.textContent = edit.path;
    const reason = document.createElement("span");
    reason.textContent = edit.reason;
    item.append(path, reason);
    elements.fileList.append(item);
  }
  elements.warnings.hidden = !plan.warnings?.length;
  elements.warnings.textContent = plan.warnings?.join(" • ") || "";
  elements.planStatus.textContent = `${plan.edits.length} arquivo(s)`;
  elements.resultPanel.hidden = false;
}

async function analyze() {
  const repository = elements.repository.value.trim();
  const branch = elements.branch.value.trim() || "main";
  const instruction = elements.instruction.value.trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) return showToast("Use o formato usuario/repositorio.", true);
  if (instruction.length < 8) return showToast("Descreva a alteração com um pouco mais de detalhe.", true);

  setBusy(true);
  elements.resultPanel.hidden = true;
  try {
    const history = await getHistory(repository);
    const plan = await api("/api/plan", { repository, branch, instruction, history, page: activeContext });
    await addHistory(repository, { role: "user", content: instruction, at: Date.now() });
    renderPlan(plan);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function applyPlan() {
  if (!pendingPlanId) return;
  setBusy(true, "Aplicando no GitHub", "Criando um único commit na branch escolhida.");
  try {
    const result = await api("/api/apply", { planId: pendingPlanId });
    await addHistory(elements.repository.value.trim(), { role: "assistant", content: elements.summary.textContent, at: Date.now() });
    elements.planStatus.textContent = "Aplicado";
    elements.applyButton.disabled = true;
    elements.applyButton.textContent = "Alteração aplicada";
    showToast("Commit criado. O Lovable poderá sincronizar a alteração.");
    if (result.commitUrl) window.open(result.commitUrl, "_blank", "noopener,noreferrer");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(false);
  }
}

elements.settingsToggle.addEventListener("click", () => { elements.settingsPanel.hidden = !elements.settingsPanel.hidden; });
elements.saveSettings.addEventListener("click", saveSettings);
elements.instruction.addEventListener("input", () => { elements.charCount.textContent = `${elements.instruction.value.length}/4000`; });
elements.analyzeButton.addEventListener("click", analyze);
elements.applyButton.addEventListener("click", applyPlan);
document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    elements.instruction.value = button.dataset.prompt;
    elements.instruction.dispatchEvent(new Event("input"));
    elements.instruction.focus();
  });
});

await loadSettings();
await detectContext();
