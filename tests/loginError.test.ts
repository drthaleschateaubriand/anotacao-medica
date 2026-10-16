import { describe, expect, it } from 'vitest'
import { describeLoginError } from '../src/lib/loginError.ts'
import { ApiError } from '../src/services/api.ts'

describe('mensagens de erro do login', () => {
  it('senha incorreta (401) ≠ limite (429) ≠ rede ≠ servidor ≠ CORS/origem', () => {
    const inv = describeLoginError(new ApiError(401, 'invalid_credentials', 'Senha incorreta.'))
    const lim = describeLoginError(new ApiError(429, 'rate_limited', 'x', 600))
    const net = describeLoginError(new TypeError('Failed to fetch'))
    const net2 = describeLoginError(new TypeError('Load failed'))
    const srv = describeLoginError(new ApiError(503, 'error', 'Erro 503'))
    const frb = describeLoginError(new ApiError(403, 'forbidden', 'x'))
    const tmo = describeLoginError(new DOMException('timeout', 'TimeoutError'))
    expect([inv.kind, lim.kind, net.kind, net2.kind, srv.kind, frb.kind, tmo.kind]).toEqual(['invalid', 'rate_limit', 'network', 'network', 'server', 'forbidden', 'timeout'])
    expect(new Set([inv.message, lim.message, net.message, srv.message, frb.message, tmo.message]).size).toBe(6)
  })
  it('429 diz quanto esperar e que a senha não foi julgada errada', () => {
    expect(describeLoginError(new ApiError(429, 'x', 'x', 900)).message).toMatch(/15 minutos/)
    expect(describeLoginError(new ApiError(429, 'x', 'x', 30)).message).toMatch(/30 segundos/)
    expect(describeLoginError(new ApiError(429, 'x', 'x', 30)).message).toMatch(/não foi julgada errada/)
  })
  it('401 diz senha incorreta; rede cita o endereço oficial; 5xx diz que a senha não foi recusada', () => {
    expect(describeLoginError(new ApiError(401, 'x', 'x')).message).toMatch(/Senha incorreta/)
    expect(describeLoginError(new TypeError('Failed to fetch')).message).toMatch(/drthaleschateaubriand\.github\.io\/anotacao-medica/)
    expect(describeLoginError(new ApiError(500, 'x', 'x')).message).toMatch(/não foi recusada/)
  })
})
