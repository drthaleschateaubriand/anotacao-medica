import { post, tokensFromResponse } from './api'
import { clearSession, saveSession } from './session'
import type { DeviceSession } from '../types'

export async function login(password: string, persistent: boolean) {
  const j = await post('auth', 'login', { password, persistent }, false)
  saveSession(tokensFromResponse(j))
}

export async function logout() {
  try { await post('auth', 'logout') } catch { /* mesmo offline, limpa localmente */ }
  clearSession()
}

export async function logoutAll() {
  await post('auth', 'logout-all')
  clearSession()
}

export async function listDevices(): Promise<DeviceSession[]> {
  return (await post('auth', 'sessions')).sessions
}

export async function revokeDevice(id: string) {
  return post('auth', 'revoke-session', { id })
}
