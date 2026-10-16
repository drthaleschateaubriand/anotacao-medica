#!/usr/bin/env bash
# Cadastra (ou remove) a chave GRATUITA de um provedor de IA sem expô-la no histórico do shell.
#
#   PROVIDER_KEY='...sua chave...' bash scripts/set-provider-key.sh groq        # grava (valida na API do provedor)
#   PROVIDER_KEY='...' bash scripts/set-provider-key.sh gemini
#   bash scripts/set-provider-key.sh status                                       # quais provedores têm chave
#   bash scripts/set-provider-key.sh gemini delete                                # remove
#   bash scripts/set-provider-key.sh openrouter clear-cooldown                    # limpa pausa (circuit breaker)
#
# Chaves grátis: Groq https://console.groq.com/keys · Gemini https://aistudio.google.com/apikey · OpenRouter https://openrouter.ai/settings/keys
# A chave é lida SOMENTE da variável PROVIDER_KEY (nunca de argumento). Use só chaves de plano GRATUITO.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
. "$here/_admin_lib.sh"
provider="${1:-}"; action="${2:-set}"
if [ "$provider" = "status" ]; then provider="groq"; action="status"; fi
case "$provider" in groq|gemini|openrouter|pollinations) ;; *) echo "uso: PROVIDER_KEY=... $0 {groq|gemini|openrouter} [set|delete|clear-cooldown] | $0 status" >&2; exit 2;; esac
if [ "$action" = "set" ]; then
  [ -n "${PROVIDER_KEY:-}" ] || { echo "Defina a variável PROVIDER_KEY (a chave NÃO é aceita como argumento)." >&2; exit 2; }
  python3 -c 'import json,os,sys; print(json.dumps({"action":"set","provider":sys.argv[1],"key":os.environ["PROVIDER_KEY"]}))' "$provider" | admin_call
else
  python3 -c 'import json,sys; print(json.dumps({"action":sys.argv[2],"provider":sys.argv[1]}))' "$provider" "$action" | admin_call
fi
