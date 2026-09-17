import { describe, expect, it } from 'vitest'
import { DUMMY_HASH, hashPassword, newToken, verifyPassword } from '../src/lib/auth'

describe('パスワード', () => {
  it('作ったハッシュは同じパスワードで通る', async () => {
    const hash = await hashPassword('correct-horse-battery')
    expect(await verifyPassword('correct-horse-battery', hash)).toBe(true)
  })

  it('違うパスワードは通らない', async () => {
    const hash = await hashPassword('correct-horse-battery')
    expect(await verifyPassword('correct-horse-batterz', hash)).toBe(false)
  })

  it('毎回 salt が変わるので、同じパスワードでもハッシュは違う', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'))
  })

  it('壊れた保存値は false にする（例外を投げない）', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false)
  })

  it('DUMMY_HASH に一致するパスワードは無い', async () => {
    // 存在しないユーザーの検証に使う捨て値。通ってしまうと素通りになる
    expect(await verifyPassword('', DUMMY_HASH)).toBe(false)
    expect(await verifyPassword('password', DUMMY_HASH)).toBe(false)
  })
})

describe('newToken', () => {
  it('毎回違う値を返す', () => {
    expect(newToken()).not.toBe(newToken())
  })

  it('長さはバイト数の2倍（hex）', () => {
    expect(newToken(8)).toHaveLength(16)
  })
})
