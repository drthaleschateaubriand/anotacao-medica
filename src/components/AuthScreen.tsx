import { useState } from 'react'
import { describeLoginError } from '../lib/loginError'
import * as auth from '../services/auth'

/** Tela de acesso: SOMENTE senha. Não existe criar conta, gerar senha nem recuperação por aqui. */
export function AuthScreen() {
  const [pw, setPw] = useState('')
  const [show, setShow] = useState(false)
  const [keep, setKeep] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function doLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!pw.trim() || busy) return
    setBusy(true); setErr('')
    try {
      await auth.login(pw, keep)
    } catch (ex) {
      setErr(describeLoginError(ex).message)
    } finally { setBusy(false) }
  }

  return (
    <div className="pt-safe pb-safe flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-5xl">📝</div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">Anotação Médica</h1>
          <p className="mt-1 text-sm text-zinc-500">Bloco de notas e IA gratuita. Acesso privado.</p>
        </div>
        <form onSubmit={doLogin} className="space-y-3" data-testid="login-form">
          <label className="block text-sm font-medium" htmlFor="pw">Senha</label>
          <div className="flex gap-2">
            <input id="pw" data-testid="password-input" type={show ? 'text' : 'password'} autoComplete="current-password" autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="go"
              value={pw} onChange={(e) => setPw(e.target.value)} maxLength={200} placeholder="Digite a senha"
              className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-3 text-lg outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-zinc-700 dark:bg-zinc-950" />
            <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Ocultar senha' : 'Mostrar senha'} data-testid="toggle-password" className="w-12 rounded-lg border border-zinc-300 text-lg dark:border-zinc-700">{show ? '🙈' : '👁️'}</button>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} className="h-4 w-4" /> Manter conectado neste dispositivo (30 dias)</label>
          {err && <p role="alert" data-testid="login-error" className="rounded-md bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{err}</p>}
          <button type="submit" data-testid="login-submit" disabled={busy || !pw.trim()} className="w-full rounded-lg bg-indigo-600 py-3 font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">{busy ? 'Entrando…' : 'Entrar'}</button>
        </form>
        <p className="mt-6 text-center text-xs text-zinc-500">App privado de uso pessoal. Não há cadastro de novas pessoas.</p>
      </div>
    </div>
  )
}
