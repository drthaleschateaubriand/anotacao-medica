// Força bruta: 5 senhas erradas => 429 com Retry-After e bloqueio também para a senha CERTA; depois limpa o bloqueio (admin) e confirma que volta ao normal.
import { ADMIN, PASSWORD, admin, check, login, section, summary } from './lib.mjs'
section('Bloqueio progressivo por IP')
await admin({ action: 'clear-login-blocks' })
const codes = []
let retry = 0
for (let i = 0; i < 8; i++) {
  const r = await login('errada-' + i)
  codes.push(r.status)
  if (r.status === 429) retry = Number(r.headers.get('retry-after') ?? r.json.retry_after ?? 0)
}
console.log('  sequência de status:', codes.join(' '))
check('primeiras falhas = 401 e depois 429', codes[0] === 401 && codes.includes(429) && codes.indexOf(429) <= 5)
check(`429 traz Retry-After (${retry}s)`, retry > 0)
const good = await login(PASSWORD)
check('com o IP bloqueado, até a senha CERTA recebe 429', good.status === 429)
const cl = await admin({ action: 'clear-login-blocks' })
check('administrador limpa o bloqueio', cl.status === 200 && cl.json.cleared >= 1)
const ok = await login(PASSWORD)
check('depois de limpar, a senha certa entra', ok.status === 200 && !!ok.json.access_token)
summary()
