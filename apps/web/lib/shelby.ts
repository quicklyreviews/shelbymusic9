/**
 * Shelby decentralized storage helper (testnet)
 *
 * Setup:
 *   npm i -g @shelby-protocol/cli
 *   shelby init                          # creates ~/.shelby/config.yaml
 *   shelby faucet --network testnet --no-open   # get APT
 *   shelby account balance               # check balance
 *   # Visit https://docs.shelby.xyz/apis/faucet/shelbyusd for ShelbyUSD tokens
 *
 * Required env vars:
 *   SHELBY_API_KEY=aptoslabs_xxx          # from shelby init or Aptos dashboard
 *   SHELBY_PRIVATE_KEY=0x...             # Ed25519 private key (hex)
 *   SHELBY_ACCOUNT_ADDRESS=0x...         # your Aptos account address
 *   SHELBY_NETWORK=testnet               # or shelbynet
 *   SHELBY_EXPIRATION_DAYS=30            # how long to keep files (default: 30)
 *
 * Public file URL: https://api.testnet.shelby.xyz/shelby/v1/blobs/{account}/{blobName}
 */


// Lazy-initialized clients
let shelbyClient: import('@shelby-protocol/sdk/node').ShelbyNodeClient | null = null
let aptosSigner: import('@aptos-labs/ts-sdk').Account | null = null

const BLOB_PATH_PREFIX = 'phonezoo/ringtones/ai-generated'

async function getShelbyClient() {
  if (!shelbyClient) {
    const { ShelbyNodeClient } = await import('@shelby-protocol/sdk/node')
    shelbyClient = new ShelbyNodeClient({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      network: (process.env.SHELBY_NETWORK || 'testnet') as any,
      apiKey: process.env.SHELBY_API_KEY,
    })
  }
  return shelbyClient
}

async function getSigner() {
  if (!aptosSigner) {
    const { Ed25519PrivateKey, Account } = await import('@aptos-labs/ts-sdk')
    const privateKeyHex = process.env.SHELBY_PRIVATE_KEY
    if (!privateKeyHex) throw new Error('SHELBY_PRIVATE_KEY not set')
    const privateKey = new Ed25519PrivateKey(privateKeyHex)
    aptosSigner = Account.fromPrivateKey({ privateKey })
  }
  return aptosSigner
}

/**
 * Upload an MP3 audio buffer to Shelby testnet.
 * Returns the public URL and blob name.
 */
export async function uploadToShelby(
  audioBuffer: Buffer,
  jobId: string
): Promise<{ url: string; blobName: string; sizeKb: number }> {
  const client = await getShelbyClient()
  const signer = await getSigner()

  const blobName = `${BLOB_PATH_PREFIX}/${jobId}.mp3`
  const expirationDays = parseInt(process.env.SHELBY_EXPIRATION_DAYS || '30', 10)

  // Expiration in microseconds (Shelby uses micros)
  const expirationMicros = BigInt(Date.now() + expirationDays * 24 * 60 * 60 * 1000) * BigInt(1000)

  await client.upload({
    signer,
    blobName,
    blobData: new Uint8Array(audioBuffer),
    expirationMicros,
  })

  const url = getShelbyPublicUrl(blobName)

  return {
    url,
    blobName,
    sizeKb: Math.round(audioBuffer.length / 1024),
  }
}

/**
 * Build the public HTTP URL for a Shelby blob.
 * Format: https://api.{network}.shelby.xyz/shelby/v1/blobs/{account}/{blobName}
 */
export function getShelbyPublicUrl(blobName: string): string {
  const network = process.env.SHELBY_NETWORK || 'testnet'
  const account = process.env.SHELBY_ACCOUNT_ADDRESS
  if (!account) throw new Error('SHELBY_ACCOUNT_ADDRESS not set')

  // shelbynet has a different URL pattern
  const baseUrl = network === 'shelbynet'
    ? 'https://api.shelbynet.shelby.xyz/shelby'
    : `https://api.${network}.shelby.xyz/shelby`

  const encodedName = blobName.split('/').map(encodeURIComponent).join('/')
  return `${baseUrl}/v1/blobs/${account}/${encodedName}`
}

/**
 * Check if Shelby is configured (all env vars present).
 */
export function isShelbyConfigured(): boolean {
  return !!(
    process.env.SHELBY_API_KEY &&
    process.env.SHELBY_PRIVATE_KEY &&
    process.env.SHELBY_ACCOUNT_ADDRESS
  )
}
