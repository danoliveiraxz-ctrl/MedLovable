# MedLovable

Extensão para Google Chrome que transforma instruções em linguagem natural em alterações revisáveis em repositórios GitHub conectados ao Lovable.

## O que esta versão faz

- identifica automaticamente o repositório aberto no GitHub ou vinculado em uma página do Lovable;
- mantém um pequeno histórico de instruções por repositório;
- envia o contexto ao backend sem expor as chaves da OpenAI e do GitHub no navegador;
- mostra um plano com todos os arquivos antes de alterar o código;
- só grava as mudanças após confirmação;
- cria um commit normal na branch escolhida, sem force push ou reescrita de histórico.

> O MedLovable usa a API da OpenAI. Ele não acessa nem continua uma conversa específica do ChatGPT.

## Estrutura

- `extension/`: extensão Chrome Manifest V3 com painel lateral.
- `server/`: backend Node.js que consulta a OpenAI e grava um único commit no GitHub.

## 1. Configurar o backend

Requisitos: Node.js 20 ou superior, uma chave da API da OpenAI e um token fine-grained do GitHub com acesso de leitura e escrita ao conteúdo dos repositórios que serão alterados.

```bash
cd server
cp .env.example .env
npm start
```

O Node.js não carrega `.env` automaticamente. No desenvolvimento, exporte as variáveis no terminal ou use o modo nativo:

```bash
node --env-file=.env src/server.js
```

Variáveis obrigatórias:

- `OPENAI_API_KEY`
- `GITHUB_TOKEN`
- `MEDLOVABLE_ACCESS_TOKEN`: senha longa criada por você para proteger o backend

Variáveis opcionais:

- `OPENAI_MODEL`: padrão `gpt-6-astra`
- `PORT`: padrão `8787`
- `ALLOWED_ORIGIN`: origem autorizada; no teste local, o padrão aceita extensões Chrome

## 2. Instalar a extensão

1. Abra `chrome://extensions`.
2. Ative **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação**.
4. Selecione a pasta `extension`.
5. Fixe o MedLovable na barra do Chrome.
6. Abra o painel, informe a URL do backend e o mesmo `MEDLOVABLE_ACCESS_TOKEN`.

## 3. Usar

1. Abra um repositório no GitHub ou o projeto correspondente no Lovable.
2. Clique no ícone do MedLovable.
3. Confira o repositório e a branch detectados.
4. Escreva a alteração desejada.
5. Clique em **Analisar alteração**.
6. Revise o resumo e os arquivos.
7. Clique em **Aplicar no GitHub**.

Após o commit chegar à branch conectada, o Lovable deverá sincronizar a alteração normalmente.

## Segurança

- nunca coloque `OPENAI_API_KEY` ou `GITHUB_TOKEN` na extensão;
- use um token GitHub limitado somente aos repositórios necessários;
- mantenha `MEDLOVABLE_ACCESS_TOKEN` longo e privado;
- publique o backend somente com HTTPS;
- revise a proposta antes de aplicar;
- revogue tokens imediatamente se eles forem expostos.

A integração da OpenAI usa a Responses API com Structured Outputs, seguindo a [documentação oficial](https://developers.openai.com/api/docs/guides/structured-outputs).
