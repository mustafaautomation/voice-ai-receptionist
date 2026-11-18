import { createHmac } from "node:crypto";

const b64url = (value: string | Buffer): string => Buffer.from(value).toString("base64url");

/**
 * Signs a short-lived Vapi public JWT (HS256, signed with the private API key).
 * The Web SDK accepts it in place of a public key. Vapi rejects it after `exp`,
 * from any other browser origin, and for any other assistant.
 */
export function signVapiPublicToken(input: {
  privateKey: string;
  orgId: string;
  assistantId: string;
  allowedOrigins: string[];
  ttlSeconds: number;
  now: Date;
}): { token: string; expiresAt: number } {
  const issuedAt = Math.floor(input.now.getTime() / 1000);
  const expiresAt = issuedAt + input.ttlSeconds;
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      orgId: input.orgId,
      iat: issuedAt,
      exp: expiresAt,
      token: {
        tag: "public",
        restrictions: {
          allowedOrigins: input.allowedOrigins,
          allowedAssistantIds: [input.assistantId],
        },
      },
    }),
  );
  const unsigned = `${header}.${payload}`;
  const signature = createHmac("sha256", input.privateKey).update(unsigned).digest("base64url");
  return { token: `${unsigned}.${signature}`, expiresAt };
}
