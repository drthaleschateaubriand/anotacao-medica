# Modelo de segurança — Anotação Médica

| Tema | Decisão |
|---|---|
| Modelo | App privado, **conta única (dono)**. `am-auth/register`, `signup`, `recover`, `reset`, `challenge`, `generate-code` respondem **403** sempre. Índice único `am_users_single_owner` impede um segundo dono |
| Credencial | **Senha livre**, sensível a maiúsculas/minúsculas; só espaços das pontas são removidos (máx. 200). Definida **apenas** pelo administrador (`scripts/set-password.sh` → `am-admin`, protegido por `ADMIN_TOKEN`). Não há UI/API pública para criar, gerar, mostrar ou recuperar senha |
| Armazenamento | PBKDF2-SHA256, 600.000 iterações, sal aleatório de 16 bytes, entrada = HMAC-SHA256(pepper do servidor, senha). Pepper em `am_server_secrets` (tabela privada). Comparação em tempo constante; sem senha definida, o login gasta o mesmo tempo e falha |
| Força bruta | por IP: 5 falhas/15 min ⇒ bloqueio de 5 min, dobrando a cada reincidência até 24 h; teto global: 100 falhas/h ⇒ bloqueio de 15 min (dobrando até 2 h); limites de requisições por IP e globais; resposta genérica “Senha incorreta.”; tentativas registradas sem a senha (`am_auth_attempts`) |
| Sessão | tokens opacos de 32 bytes, só o SHA-256 no banco; acesso 15 min; refresh com **rotação** e detecção de reuso (revoga a sessão); “manter conectado” 30 dias / sessão curta 12 h; trocar a senha revoga todas as sessões |
| Autorização | `user_id` só vem da sessão; toda consulta filtra por ele; recurso alheio = 404 |
| Banco | `am_*`: RLS ligado e forçado, **sem policies**, `REVOKE ALL` de `anon/authenticated/public`; funções RPC (`am_rl_hit`, `am_notes_list`…) só para `service_role` |
| Isolamento | O projeto Supabase é compartilhado com outro app do mesmo dono; este app usa **somente** tabelas/funções com prefixo `am_` e Edge Functions `am-*`, sem tocar nas do outro |
| CORS | origens fixas: `https://drthaleschateaubriand.github.io` e localhost; outras origens recebem 403 |
| Segredos | pepper, hash do `ADMIN_TOKEN` e chaves de provedores ficam em `am_server_secrets`; `ADMIN_TOKEN` e a senha ficam em arquivos locais (modo 600) **fora do repositório**. O front só tem URL e chave *publishable* |
| Cliente | tokens em `localStorage` (manter conectado) ou `sessionStorage`; XSS é o principal risco residual — Markdown sem HTML bruto |
| Dados clínicos | Notas ficam só no banco do dono. O Chat IA envia o texto a provedores gratuitos (podem registrar/treinar): o app avisa para **não digitar dados que identifiquem pacientes** |
| Skills/agentes | texto de prompt delimitado; não alteram limites nem regras do servidor |

## Administração

- `scripts/set-password.sh` — define/troca a senha (lê `senha.txt` local; nunca imprime).
- `scripts/set-provider-key.sh` — chaves gratuitas de Groq/Gemini/OpenRouter.
- Desbloquear login (bloqueios por tentativas): ação `clear-login-blocks` de `am-admin` (exige `ADMIN_TOKEN`), p. ex.:
  `source scripts/_admin_lib.sh; echo '{"action":"clear-login-blocks"}' | admin_call`

## Limitações conhecidas

Senha curta/previsível reduz a margem contra ataque direcionado (mitigado por PBKDF2 e bloqueios); o IP do cliente vem do cabeçalho do gateway da Supabase; o teto global de falhas pode, em tese, ser usado para atrapalhar o login do dono por alguns minutos (sessões já abertas continuam funcionando).
