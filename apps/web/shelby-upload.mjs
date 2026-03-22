#!/usr/bin/env node
/**
 * Shelby upload worker — spawned by Next.js webhook as a child process.
 * Usage: node --dns-result-order=ipv4first shelby-upload.mjs <jobId>
 * Input : MP3 bytes via stdin
 * Output: JSON { url, sizeKb } on stdout
 */
import { readFileSync } from 'fs'
import dns from 'dns'

const jobId = process.argv[2]
if (!jobId) { process.stderr.write('Usage: shelby-upload.mjs <jobId>\n'); process.exit(1) }

// Auto-load .env.local when run standalone (child process gets env from parent)
if (!process.env.SHELBY_API_KEY) {
  try {
    const lines = readFileSync(new URL('.env.local', import.meta.url), 'utf8').split('\n')
    for (const line of lines) {
      if (!line || line.startsWith('#') || !line.includes('=')) continue
      const i = line.indexOf('=')
      process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim()
    }
  } catch { /* rely on parent env */ }
}

const rawKey = (process.env.SHELBY_PRIVATE_KEY || '').replace(/^ed25519-priv-/, '')
if (!rawKey) { process.stderr.write('SHELBY_PRIVATE_KEY not set\n'); process.exit(1) }

// Read audio data from stdin
const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const audioBuffer = Buffer.concat(chunks)

// ── DNS strategy ────────────────────────────────────────────────────────────
// Windows DNS can't resolve api.testnet.shelby.xyz.
// Steps:
//  1. Pre-resolve via Cloudflare DoH (1.1.1.1 is a literal IP — no OS DNS needed).
//  2. Patch dns.lookup ONLY for the Shelby hostname; pass all others through
//     with the exact same argument form to avoid breaking got v11.
// ────────────────────────────────────────────────────────────────────────────

const shelbyHost = `api.${process.env.SHELBY_NETWORK || 'testnet'}.shelby.xyz`
let shelbyIP = null

try {
  const res = await fetch(
    `https://1.1.1.1/dns-query?name=${encodeURIComponent(shelbyHost)}&type=A`,
    { headers: { Accept: 'application/dns-json' } }
  )
  const data = await res.json()
  shelbyIP = data.Answer?.find(r => r.type === 1)?.data ?? null
  if (shelbyIP) process.stderr.write(`[dns] ${shelbyHost} → ${shelbyIP}\n`)
} catch (e) {
  process.stderr.write(`[dns] DoH failed: ${e.message}\n`)
}

if (shelbyIP) {
  // Capture the native lookup BEFORE any imports that might overwrite it
  const _nativeLookup = dns.lookup.bind(dns)
  const _resolvedIP = shelbyIP
  const _shelbyHost = shelbyHost

  dns.lookup = function patchedLookup(hostname, options, callback) {
    if (hostname === _shelbyHost) {
      // Resolve inline with our cached IP
      const cb = typeof options === 'function' ? options : callback
      const opts = typeof options === 'object' && options !== null ? options : {}
      if (opts.all) {
        cb(null, [{ address: _resolvedIP, family: 4 }])
      } else {
        cb(null, _resolvedIP, 4)
      }
    } else if (typeof options === 'function') {
      // 2-arg form: dns.lookup(hostname, callback) — preserve exactly
      _nativeLookup(hostname, options)
    } else {
      // 3-arg form: dns.lookup(hostname, options, callback)
      _nativeLookup(hostname, options, callback)
    }
  }
  process.stderr.write(`[dns] lookup patched for ${shelbyHost}\n`)
}

// Dynamic imports — avoids got v11/Node.js v22 static-init crash
const { Ed25519PrivateKey, Account } = await import('@aptos-labs/ts-sdk')
const { ShelbyNodeClient } = await import('@shelby-protocol/sdk/node')

const privateKey = new Ed25519PrivateKey(rawKey)
const signer = Account.fromPrivateKey({ privateKey })

const client = new ShelbyNodeClient({
  network: process.env.SHELBY_NETWORK || 'testnet',
  apiKey: process.env.SHELBY_API_KEY,
})

const blobName = `phonezoo/ringtones/ai-generated/${jobId}.mp3`
const expirationDays = parseInt(process.env.SHELBY_EXPIRATION_DAYS || '30', 10)
const expirationMicros = BigInt(Date.now() + expirationDays * 24 * 60 * 60 * 1000) * 1000n

await client.upload({
  signer,
  blobName,
  blobData: new Uint8Array(audioBuffer),
  expirationMicros,
})

const network = process.env.SHELBY_NETWORK || 'testnet'
const base = network === 'shelbynet'
  ? 'https://api.shelbynet.shelby.xyz/shelby'
  : `https://api.${network}.shelby.xyz/shelby`

const encodedName = blobName.split('/').map(encodeURIComponent).join('/')
const url = `${base}/v1/blobs/${signer.accountAddress}/${encodedName}`

process.stdout.write(JSON.stringify({ url, sizeKb: Math.round(audioBuffer.length / 1024) }))
