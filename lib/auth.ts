// OWNER: Integrator.  FROZEN after Phase 0.
//
// NODE RUNTIME ONLY.  bcryptjs does not run on Edge.
// Never import this file from middleware.ts — import lib/jwt.ts there instead.

import bcrypt from 'bcryptjs'
import { cookies } from 'next/headers'
import { COOKIE, verifyToken, type Session } from './jwt'

export { COOKIE, signToken, verifyToken } from './jwt'
export type { Role, Session } from './jwt'

// cost 10, not 12 — bcryptjs is pure JS and therefore slower per round
export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10)
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash)
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value
  return token ? verifyToken(token) : null
}
