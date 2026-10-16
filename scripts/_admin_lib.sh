# Biblioteca comum dos scripts de administração (não execute direto). Nada aqui imprime segredos.
# Arquivos PRIVADOS ficam FORA do repositório: /workspace/anotacao-medica-private (modo 600): admin_token.txt e senha.txt.
FN_URL="${FN_URL:-https://kvikbqjmtlthywbgxdii.supabase.co/functions/v1}"
PRIVATE_DIR="${PRIVATE_DIR:-/workspace/anotacao-medica-private}"
TOKEN_FILE="${ADMIN_TOKEN_FILE:-$PRIVATE_DIR/admin_token.txt}"
if [ -z "${ADMIN_TOKEN:-}" ]; then
  [ -r "$TOKEN_FILE" ] || { echo "Token admin não encontrado em $TOKEN_FILE (ou defina ADMIN_TOKEN)." >&2; exit 1; }
  ADMIN_TOKEN="$(cat "$TOKEN_FILE")"
fi
# admin_call <arquivo-com-json-ou-> : envia o corpo JSON (stdin) para am-admin e imprime a resposta (que nunca contém segredos)
admin_call() {
  curl -sS -X POST "$FN_URL/am-admin" -H "content-type: application/json" -H "x-admin-token: $ADMIN_TOKEN" --data-binary @-
  echo
}
