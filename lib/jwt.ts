// OWNER: Integrator.  FROZEN after Phase 0.
//
// EDGE-SAFE.  This file must only ever import `jose`.
// middleware.ts runs on the Edge runtime and imports from here — never from
// lib/auth.ts, which pulls in bcryptjs and will not run on Edge.

import { SignJWT, jwtVerify } from 'jose'

export type Role = 'sales_rep' | 'sales_manager' | 'finance' | 'admin' | 'portal'

export type Session = {
  userId: number
  role: Role
  customerId: number | null
  email: string
  fullName: string
}

export const COOKIE = 'df_token'

function secret() {
  const s = process.env.JWT_SECRET
  if (!s) throw new Error('JWT_SECRET is not set')
  return new TextEncoder().encode(s)
}

export async function signToken(session: Session): Promise<string> {
  return new SignJWT({ ...session })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(secret())
}

export async function verifyToken(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, secret())
    return payload as unknown as Session
  } catch {
    return null
  }
}
