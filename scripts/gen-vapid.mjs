// Generate a VAPID key pair for Web Push.
//
//   node scripts/gen-vapid.mjs
//
// VAPID is just an ECDSA P-256 key pair. The PUBLIC key is shipped in the
// browser (safe — it's meant to be public) and the PRIVATE key is a server
// secret used to sign the push requests. Run this once, then set the printed
// values as environment variables (see SETUP.md → Web Push):
//
//   VITE_VAPID_PUBLIC_KEY   (public — frontend, safe to expose)
//   VAPID_PRIVATE_KEY       (secret — serverless function only)
//   VAPID_SUBJECT           (a mailto: or https: contact, e.g. mailto:ac@seed-malaysia.com)
//
// No dependency needed — pure node:crypto, so it runs anywhere Node does.

import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pub = publicKey.export({ format: "jwk" });
const priv = privateKey.export({ format: "jwk" });

const b64u = (s) => Buffer.from(s, "base64url");
// Web Push wants the public key as the 65-byte uncompressed point (0x04 ‖ X ‖ Y).
const applicationServerKey = Buffer.concat([Buffer.from([0x04]), b64u(pub.x), b64u(pub.y)])
  .toString("base64url");
// ...and the private key as the raw 32-byte scalar (the JWK 'd' is already that, base64url).
const privateKeyB64 = priv.d;

console.log("\nVAPID key pair generated. Set these as environment variables:\n");
console.log(`VITE_VAPID_PUBLIC_KEY=${applicationServerKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKeyB64}`);
console.log(`VAPID_SUBJECT=mailto:ac@seed-malaysia.com`);
console.log(
  "\n• VITE_VAPID_PUBLIC_KEY is safe to commit / expose (it ships in the browser).\n" +
  "• VAPID_PRIVATE_KEY is a SECRET — set it only in Vercel env, never commit it.\n" +
  "• Add all three to the Vercel project (Settings → Environment Variables) and to\n" +
  "  your local .env for testing. Regenerate any time — existing subscriptions just\n" +
  "  stop working and users re-enable alerts.\n"
);
