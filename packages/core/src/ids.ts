import { customAlphabet } from "nanoid";

// DNS-label-safe: lowercase letters + digits only, no hyphens at the boundary.
// Used as the deployment ID, which becomes both a hostname segment
// (`app-<id>.127.0.0.1.sslip.io`) and a Swarm service name (`app-<id>`).
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const generate = customAlphabet(ALPHABET, 10);

export const ID_REGEX = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function generateDnsLabelSafeId(): string {
  return generate();
}

export function validateId(id: string): asserts id is string {
  if (!ID_REGEX.test(id)) {
    throw new Error(`Invalid deployment id: ${JSON.stringify(id)}`);
  }
}
