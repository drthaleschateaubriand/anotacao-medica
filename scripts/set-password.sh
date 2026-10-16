#!/usr/bin/env bash
# Define (ou troca) a SENHA do app. É a única forma: não existe "criar conta", "gerar senha" nem recuperação pública.
# A senha é lida de um ARQUIVO LOCAL fora do repositório (padrão: /workspace/anotacao-medica-private/senha.txt, modo 600),
# nunca de argumento de linha de comando, e NUNCA é impressa. O servidor guarda só PBKDF2-SHA256 (sal + pepper).
# Trocar a senha encerra todas as sessões abertas; conversas, notas, skills e agentes são mantidos.
#
#   printf '%s' 'nova senha' > /workspace/anotacao-medica-private/senha.txt && chmod 600 /workspace/anotacao-medica-private/senha.txt
#   bash scripts/set-password.sh          # aplica
#   bash scripts/set-password.sh status   # mostra se há senha definida (sem revelar nada)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
. "$here/_admin_lib.sh"
if [ "${1:-}" = "status" ]; then
  echo '{"action":"owner-status"}' | admin_call
  exit 0
fi
PW_FILE="${PASSWORD_FILE:-$PRIVATE_DIR/senha.txt}"
[ -r "$PW_FILE" ] || { echo "Arquivo de senha não encontrado: $PW_FILE" >&2; exit 1; }
PW_FILE="$PW_FILE" python3 -c 'import json,os; print(json.dumps({"action":"set-password","password":open(os.environ["PW_FILE"],encoding="utf-8").read()}))' | admin_call
