# Anotação Médica

Bloco de notas **e** assistente de IA gratuita para pequenos textos do dia a dia no hospital. App privado: **uma única conta, protegida por senha**, sem cadastro de outras pessoas.

- **App:** https://drthaleschateaubriand.github.io/anotacao-medica/
- **Instalável no celular/computador** (PWA): no navegador, “Adicionar à tela inicial” / “Instalar app”.

> ⚠️ **Não digite dados que identifiquem pacientes** (nome, CPF, prontuário). Notas ficam no seu banco Supabase, mas o texto enviado ao **Chat IA** vai para provedores gratuitos (Groq, Google Gemini, OpenRouter, Pollinations), que podem registrar ou usar o texto. A IA pode errar e **não substitui o julgamento médico**.

## Como usar

1. Abra o app e entre com a **senha** (maiúsculas e minúsculas contam; só espaços nas pontas são ignorados). Marque “Manter conectado” para ficar 30 dias no aparelho.
2. O app abre em **📝 Notas**: um bloco de notas com lista, busca, fixar (📌), copiar (📋), baixar `.txt` (⤓) e excluir (🗑️). O texto é **salvo automaticamente** (indicador “Salvo ✓”) e sincroniza entre aparelhos (atualiza ao focar a aba e a cada ~20 s). Se a mesma nota for editada em dois aparelhos ao mesmo tempo, nada se perde: o texto do aparelho que salvou depois vira uma nota “(conflito)”.
3. **✨ IA** dentro da nota envia o texto ao **💬 Chat IA** (melhorar redação, resumir, corrigir ortografia, organizar em tópicos).
4. No **Chat IA** as conversas e mensagens ficam salvas (histórico, busca, fixar, renomear, exportar). O modo **Automático** escolhe o melhor modelo gratuito disponível e troca sozinho se um falhar ou atingir o limite. Conversas longas são resumidas automaticamente.
5. **Memórias** (Ajustes → Memória): fatos que você pede para a IA lembrar sempre (ex.: “prefiro respostas curtas”).

### Skills e agentes (para a IA manter sempre o mesmo padrão)

- **Skill** = instrução reutilizável (nome, descrição, instruções de até 4000 caracteres, modelo preferido opcional). *Ajustes → Skills → ＋ Nova skill* (ou “Adicionar exemplos”: Texto clínico conciso, Formato SOAP, Tom formal). Marque **“Ativar em todas as conversas”** para torná-la **global** (até 10).
- **Agente** = persona com instruções salvas, com **skills anexadas**. *Ajustes → Agentes → ＋ Novo agente*; marque as skills do agente. Escolha o agente no botão do cabeçalho do Chat (próxima conversa ou conversa aberta).
- Ordem fixa no prompt: **instrução base (uso hospitalar, pt-BR, concisa, sem inventar fatos clínicos, “apoio, não substitui o médico”) → skills globais → agente (com suas skills) → memórias → resumo**.
- Skills/agentes são só texto do prompt: não alteram limites nem regras de segurança do servidor.

## Trocar a senha (só o administrador)

Não existe “criar conta”, “gerar senha” nem recuperação pública. A senha só é definida por script, usando o `ADMIN_TOKEN` que fica **fora do Git**:

```bash
printf '%s' 'nova senha' > /workspace/anotacao-medica-private/senha.txt && chmod 600 /workspace/anotacao-medica-private/senha.txt
bash scripts/set-password.sh          # grava (nunca imprime a senha); encerra as sessões abertas
bash scripts/set-password.sh status   # só mostra se há senha definida
```

No servidor ficam apenas o **hash PBKDF2-SHA256** (600 mil iterações, sal próprio + pepper secreto). A senha **não** está no código, no histórico do Git nem no app publicado.
Se você mesmo se bloquear com tentativas erradas: `echo '{"action":"clear-login-blocks"}'` via `scripts/_admin_lib.sh` (ver `docs/SEGURANCA.md`) ou aguarde o bloqueio expirar.

## Provedores de IA gratuitos e limites

| Provedor | Chave | Observação |
|---|---|---|
| **Pollinations** | não precisa | anônimo, fila e limites por IP; usado como último recurso |
| **Google Gemini** | grátis (AI Studio) | plano gratuito com cotas por modelo; o Google pode usar os dados |
| **Groq** | grátis | limites por minuto/dia por modelo |
| **OpenRouter** | grátis | só modelos `:free`, limites diários baixos |

**Os limites dos planos gratuitos são definidos pelos provedores e podem mudar a qualquer momento; nada aqui é ilimitado.** Quando todos atingem o limite, o app avisa e você tenta de novo depois. Não há provedor pago no app.

Adicionar uma chave grátis (opcional; nunca vai para o Git nem para o chat):

```bash
PROVIDER_KEY='sua-chave' bash scripts/set-provider-key.sh groq     # ou gemini / openrouter
bash scripts/set-provider-key.sh status
```
Chaves grátis: [Groq](https://console.groq.com/keys) · [Gemini](https://aistudio.google.com/apikey) · [OpenRouter](https://openrouter.ai/settings/keys).

## Arquitetura

- **Front:** React + Vite + Tailwind (PWA), publicado no GitHub Pages (branch `gh-pages`, `npm run deploy`).
- **Back:** Supabase — tabelas `am_*` (RLS ligado e forçado, **sem policies**, `REVOKE` para anon/authenticated) e Edge Functions `am-auth`, `am-chat`, `am-data`, `am-admin`. O navegador nunca acessa tabelas direto: só as funções, com `user_id` vindo da sessão.
- **Segurança:** ver [`docs/SEGURANCA.md`](docs/SEGURANCA.md).

## Desenvolvimento

```bash
npm install
npm run dev            # http://localhost:5173/anotacao-medica/
npm run lint && npx tsc -b && npm test
npm run bundle:functions   # gera dist-fn/*.js (requer Deno) para publicar as funções
npm run deploy         # build + publica no GitHub Pages
npm run test:e2e       # teste de ponta a ponta contra o backend publicado (usa a senha do arquivo local)
```
Migrações em `supabase/migrations/` (aplicar na ordem). Variáveis do front (`.env.production`) têm só valores públicos (URL e chave *publishable* do Supabase).

## Limitações

- Conta única; sem recuperação pública (quem tem o `ADMIN_TOKEN` redefine a senha).
- Uma senha curta/previsível é o ponto fraco: por isso há bloqueio progressivo por IP e um teto global de falhas, mas **quem souber ou adivinhar a senha entra**. Use uma senha mais forte se o app guardar algo sensível.
- Cotas gratuitas das IAs podem acabar ou mudar; respostas podem falhar temporariamente.
