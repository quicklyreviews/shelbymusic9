/**
 * Test uploading a small file to Shelby testnet using the Node.js SDK.
 *
 * Run:
 *   node scripts/test-shelby-upload.mjs
 */

import { ShelbyNodeClient } from "@shelby-protocol/sdk/node";
import { Account, Ed25519PrivateKey, Network } from "@aptos-labs/ts-sdk";

// ── Config ─────────────────────────────────────────────────────────────────
const SHELBY_API_KEY     = "aptoslabs_FwX7T1chRXZ_HYDJSKkdcWthnETMEFr7rmR4irarhVRVy";
const SHELBY_PRIVATE_KEY = "0x48925be78dc55d3956c1aa09cecb59917a1de144b58cbe6b06a35406da40d2dd";
const NETWORK            = Network.TESTNET;

// ── Signer ──────────────────────────────────────────────────────────────────
const privateKey = new Ed25519PrivateKey(SHELBY_PRIVATE_KEY);
const account    = Account.fromPrivateKey({ privateKey });
console.log("Account address:", account.accountAddress.toString());

// ── Client ──────────────────────────────────────────────────────────────────
const shelby = new ShelbyNodeClient({ network: NETWORK, apiKey: SHELBY_API_KEY });

// ── Test data ────────────────────────────────────────────────────────────────
const testData = new TextEncoder().encode("Hello from PhoneZoo AI Ringtone Generator! " + Date.now());
const blobName = `phonezoo/test/hello-${Date.now()}.txt`;

const expirationMicros = BigInt(Date.now() + 30 * 24 * 60 * 60 * 1000) * 1000n; // 30 days

console.log(`\nUploading "${blobName}" (${testData.length} bytes) to Shelby testnet...`);

try {
  await shelby.uploadBlobs({
    blobs: [{ blobName, blobData: testData }],
    expirationMicros,
    signer: account,
  });

  const publicUrl = `https://api.testnet.shelby.xyz/shelby/v1/blobs/${account.accountAddress}/${blobName.split("/").map(encodeURIComponent).join("/")}`;
  console.log("\n✓ Upload successful!");
  console.log("Public URL:", publicUrl);
} catch (err) {
  console.error("\n✗ Upload failed:", err.message ?? err);
  process.exit(1);
}
