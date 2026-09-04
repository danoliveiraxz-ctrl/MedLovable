function normalizeRepository(value) {
  if (!value) return null;

  const match = value.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
  if (!match) return null;

  const owner = match[1];
  const repository = match[2].replace(/\.git$/i, "");
  const blocked = new Set(["settings", "marketplace", "features", "topics", "collections"]);

  if (blocked.has(owner.toLowerCase()) || !owner || !repository) return null;
  return `${owner}/${repository}`;
}

function detectRepository() {
  const fromLocation = normalizeRepository(window.location.href);
  if (fromLocation) return fromLocation;

  const candidates = Array.from(document.querySelectorAll('a[href*="github.com/"]'));
  for (const anchor of candidates) {
    const repository = normalizeRepository(anchor.href);
    if (repository) return repository;
  }

  const textMatch = document.body.innerText.match(/[\w.-]+\/[\w.-]+/);
  return textMatch ? textMatch[0] : null;
}

function getContext() {
  return {
    repository: detectRepository(),
    url: window.location.href,
    title: document.title,
    source: window.location.hostname.includes("github.com") ? "github" : "lovable",
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "MEDLOVABLE_GET_CONTEXT") return false;
  sendResponse(getContext());
  return true;
});

