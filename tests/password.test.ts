import { describe, expect, it } from 'vitest'
import { hashPassword, normalizePassword, verifyPassword } from '../supabase/functions/_shared/password.ts'

// Senha de TESTE (não é a senha real do app).
const PW = 'Senha-De-Teste-22'
describe('senha única', () => {
  it('normaliza: só aparas nas pontas; maiúsculas/minúsculas e meio preservados', () => {
    expect(normalizePassword('  ' + PW + '\n')).toEqual({ ok: true, value: PW })
    expect(normalizePassword('a b')).toEqual({ ok: true, value: 'a b' })
    expect(normalizePassword('   ')).toMatchObject({ ok: false, reason: 'empty' })
    expect(normalizePassword(5)).toMatchObject({ ok: false, reason: 'type' })
    expect(normalizePassword('x'.repeat(201))).toMatchObject({ ok: false, reason: 'too_long' })
  })
  it('PBKDF2: verifica só a senha exata (sensível a maiúsculas), com sal e pepper', async () => {
    const h = await hashPassword(PW, 'pepper1', 20_000)
    expect(h).toMatch(/^pbkdf2\$20000\$[0-9a-f]{32}\$[0-9a-f]{64}$/)
    expect(h).not.toContain(PW)
    expect(await verifyPassword(PW, h, 'pepper1')).toBe(true)
    expect(await verifyPassword(PW.toLowerCase(), h, 'pepper1')).toBe(false)
    expect(await verifyPassword(PW + ' ', h, 'pepper1')).toBe(false)
    expect(await verifyPassword(PW, h, 'outro-pepper')).toBe(false)
    expect(await hashPassword(PW, 'pepper1', 20_000)).not.toBe(h) // sal aleatório
  })
  it('sem senha definida nunca autentica (e gasta tempo parecido)', async () => {
    expect(await verifyPassword(PW, null, 'p')).toBe(false)
    expect(await verifyPassword('', 'lixo', 'p')).toBe(false)
  })
})
