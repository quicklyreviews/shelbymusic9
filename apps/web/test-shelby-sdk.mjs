// Test full Shelby SDK upload (with on-chain registration)
// Run: node test-shelby-sdk.mjs
import { readFileSync } from 'fs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)

process.env.SHELBY_API_KEY = env.SHELBY_API_KEY
process.env.SHELBY_PRIVATE_KEY = env.SHELBY_PRIVATE_KEY
process.env.SHELBY_ACCOUNT_ADDRESS = env.SHELBY_ACCOUNT_ADDRESS
process.env.SHELBY_NETWORK = env.SHELBY_NETWORK || 'testnet'

const { ShelbyNodeClient } = await import('@shelby-protocol/sdk/node')
const { Ed25519PrivateKey, Account } = await import('@aptos-labs/ts-sdk')

const rawKey = env.SHELBY_PRIVATE_KEY.replace(/^ed25519-priv-/, '')
const privateKey = new Ed25519PrivateKey(rawKey)
const signer = Account.fromPrivateKey({ privateKey })
console.log('Signer address:', signer.accountAddress.toString())

const client = new ShelbyNodeClient({
  network: env.SHELBY_NETWORK || 'testnet',
  apiKey: env.SHELBY_API_KEY,
})

const blobName = `phonezoo/test/sdk-test-${Date.now()}.mp3`
const expirationMicros = BigInt(Date.now() + 30 * 24 * 60 * 60 * 1000) * 1000n

console.log('Uploading blob:', blobName)
console.log('(This takes ~10s for blockchain registration...)')

await client.upload({
  signer,
  blobName,
  blobData: new Uint8Array(512),
  expirationMicros,
})

const network = env.SHELBY_NETWORK || 'testnet'
const base = `https://api.${network}.shelby.xyz/shelby`
const url = `${base}/v1/blobs/${signer.accountAddress}/${blobName.split('/').map(encodeURIComponent).join('/')}`
console.log('\nSuccess! URL:', url)
