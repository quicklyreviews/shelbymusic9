import { readFileSync } from 'fs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)

const apiKey = env.SHELBY_API_KEY
const account = env.SHELBY_ACCOUNT_ADDRESS
const network = env.SHELBY_NETWORK || 'testnet'
const base = `https://api.${network}.shelby.xyz/shelby`
const blob = `phonezoo/test/cli-test-${Date.now()}.mp3`
const auth = apiKey ? { Authorization: `Bearer ${apiKey}` } : {}

console.log('Account:', account)
console.log('Blob   :', blob)

const r1 = await fetch(`${base}/v1/multipart-uploads`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...auth },
  body: JSON.stringify({ rawAccount: account, rawBlobName: blob, rawPartSize: 5242880 }),
})
const t1 = await r1.text()
console.log('1. Initiate:', r1.status, t1)
if (!r1.ok) process.exit(1)

const { uploadId } = JSON.parse(t1)

const r2 = await fetch(`${base}/v1/multipart-uploads/${uploadId}/parts/0`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/octet-stream', ...auth },
  body: new Uint8Array(512),
})
console.log('2. Upload  :', r2.status, await r2.text())
if (!r2.ok) process.exit(1)

const r3 = await fetch(`${base}/v1/multipart-uploads/${uploadId}/complete`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...auth },
})
console.log('3. Complete:', r3.status, await r3.text())

const url = `${base}/v1/blobs/${account}/${blob.split('/').map(encodeURIComponent).join('/')}`
console.log('\nURL:', url)
