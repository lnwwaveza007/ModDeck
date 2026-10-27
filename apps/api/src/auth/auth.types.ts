import type { Request } from 'express';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  studentId: string | null;
}

/** Identity extracted from a validated Entra ID token. */
export interface EntraIdentity {
  subject: string; // Entra object ID (oid)
  email: string;
  displayName: string;
  studentId: string | null;
}

export type AuthedRequest = Request & { user?: AuthUser };
