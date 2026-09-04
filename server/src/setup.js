import { createInterface } from "node:readline/promises";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { stdin as input, stdout as output } from "node:process";

const envPath = new URL("../.env", import.meta.url);

if (existsSync(envPath)) {
  const current = readFileSync(envPath, "utf8");
  const accessToken = current.match(/^MEDLOVABLE_ACCESS_TOKEN=(.+)$/m)?.[1];
  console.log("\nO MedLovable já está configurado.");
  if (accessToken) console.log(`Senha para colocar na extensão: ${accessToken}`);
  console.log("Para refazer a configuração, apague server/.env e execute novamente.\n");
  process.exit(0);
}

const prompt = createInterface({ input, output });
console.log("\nCONFIGURAÇÃO DO MEDLOVABLE\n");
console.log("As chaves serão guardadas somente neste computador, no arquivo server/.env.\n");

const openaiKey = (await prompt.question("Cole sua OPENAI_API_KEY: ")).trim();
const githubToken = (await prompt.question("Cole seu token fine-grained do GitHub: ")).trim();
prompt.close();

if (!openaiKey.startsWith("sk-") || githubToken.length < 20) {
  console.error("\nAs credenciais parecem inválidas. Nenhum arquivo foi criado.");
  process.exit(1);
}

const accessToken = randomBytes(24).toString("hex");
const env = [
  `OPENAI_API_KEY=${openaiKey}`,
  "OPENAI_MODEL=gpt-6-astra",
  `GITHUB_TOKEN=${githubToken}`,
  `MEDLOVABLE_ACCESS_TOKEN=${accessToken}`,
  "PORT=8787",
  "ALLOWED_ORIGIN=chrome-extension://",
  "",
].join("\n");

writeFileSync(envPath, env, { encoding: "utf8", mode: 0o600 });
console.log("\nConfiguração salva.");
console.log(`Senha para colocar na extensão: ${accessToken}`);
console.log("Guarde esta senha. O servidor será iniciado agora.\n");

