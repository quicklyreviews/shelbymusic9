// @ts-nocheck
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
    const rawKey = process.env.SHELBY_PRIVATE_KEY
    if (!rawKey) throw new Error('SHELBY_PRIVATE_KEY not set')
    // Strip AIP-80 prefix if present: "ed25519-priv-0x..." → "0x..."
    const privateKeyHex = rawKey.replace(/^ed25519-priv-/, '')
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
  const expirationMicros = BigInt(Date.now() + expirationDays * 24 * 60 * 60 * 1000) * 1000n

  await client.upload({
    signer,
    blobName,
    blobData: new Uint8Array(audioBuffer),
    expirationMicros,
  })

  // Use the signer's actual account address (not env var, to avoid mismatch)
  const url = getShelbyPublicUrl(blobName, signer.accountAddress.toString())

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
export function getShelbyPublicUrl(blobName: string, accountOverride?: string): string {
  const network = process.env.SHELBY_NETWORK || 'testnet'
  const account = accountOverride || process.env.SHELBY_ACCOUNT_ADDRESS
  if (!account) throw new Error('SHELBY_ACCOUNT_ADDRESS not set')

  // shelbynet has a different URL pattern
  const baseUrl = network === 'shelbynet'
    ? 'https://api.shelbynet.shelby.xyz/shelby'
    : `https://api.${network}.shelby.xyz/shelby`

  const encodedName = blobName.split('/').map(encodeURIComponent).join('/')
  return `${baseUrl}/v1/blobs/${account}/${encodedName}`
}

/**
 * Upload MP3 to Shelby by spawning a child Node.js process (shelby-upload.mjs).
 * This bypasses Next.js's module context where got v11 crashes.
 * The child process uses the full Shelby SDK including on-chain blob registration.
 */
export async function uploadViaProcess(
  audioBuffer: Buffer,
  jobId: string
): Promise<{ url: string; blobName: string; sizeKb: number }> {
  const { spawn } = await import('child_process')
  const { resolve } = await import('path')

  return new Promise((res, rej) => {
    const script = resolve(process.cwd(), 'shelby-upload.mjs')
    const child = spawn('node', ['--dns-result-order=ipv4first', script, jobId], {
      env: { ...process.env },  // inherit full env (PATH, HOME, NODE_OPTIONS, Shelby vars)
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // Kill after 90s (blockchain reg ~10s + upload time)
    const timer = setTimeout(() => { child.kill(); rej(new Error('shelby-upload timeout')) }, 90_000)

    child.stdin.write(audioBuffer)
    child.stdin.end()

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => { stdout += d })
    child.stderr.on('data', (d: Buffer) => { stderr += d })

    child.on('close', (code: number) => {
      clearTimeout(timer)
      if (code !== 0) { rej(new Error(`shelby-upload exited ${code}: ${stderr.slice(0, 500)}`)); return }
      try {
        const { url, sizeKb } = JSON.parse(stdout.trim())
        const blobName = `phonezoo/ringtones/ai-generated/${jobId}.mp3`
        res({ url, blobName, sizeKb })
      } catch {
        rej(new Error(`Bad output from shelby-upload: ${stdout}`))
      }
    })
  })
}

/**
 * Upload an MP3 audio buffer to Shelby testnet using the REST API directly.
 * Bypasses @shelby-protocol/sdk and @aptos-labs/ts-sdk (which pull in got v11 that crashes).
 * Skips on-chain blob registration — file is still accessible via HTTP CDN for testing.
 */
export async function uploadToShelbyDirect(
  audioBuffer: Buffer,
  jobId: string
): Promise<{ url: string; blobName: string; sizeKb: number }> {
  const apiKey = process.env.SHELBY_API_KEY
  const account = process.env.SHELBY_ACCOUNT_ADDRESS
  if (!account) throw new Error('SHELBY_ACCOUNT_ADDRESS not set')

  const network = process.env.SHELBY_NETWORK || 'testnet'
  const baseUrl = network === 'shelbynet'
    ? 'https://api.shelbynet.shelby.xyz/shelby'
    : `https://api.${network}.shelby.xyz/shelby`

  const blobName = `${BLOB_PATH_PREFIX}/${jobId}.mp3`
  const authHeader: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {}

  // 1. Initiate multipart upload
  const startRes = await fetch(`${baseUrl}/v1/multipart-uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader },
    body: JSON.stringify({ rawAccount: account, rawBlobName: blobName, rawPartSize: 5_242_880 }),
  })
  if (!startRes.ok) throw new Error(`Shelby initiate failed: ${startRes.status} ${await startRes.text()}`)
  const { uploadId } = await startRes.json() as { uploadId: string }

  // 2. Upload the entire file as a single part (MP3s are well under 5 MB)
  const uploadRes = await fetch(`${baseUrl}/v1/multipart-uploads/${uploadId}/parts/0`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream', ...authHeader },
    body: audioBuffer,
  })
  if (!uploadRes.ok) throw new Error(`Shelby upload part failed: ${uploadRes.status} ${await uploadRes.text()}`)

  // 3. Complete the upload
  const completeRes = await fetch(`${baseUrl}/v1/multipart-uploads/${uploadId}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader },
  })
  if (!completeRes.ok) throw new Error(`Shelby complete failed: ${completeRes.status} ${await completeRes.text()}`)

  const encodedName = blobName.split('/').map(encodeURIComponent).join('/')
  const url = `${baseUrl}/v1/blobs/${account}/${encodedName}`
  return { url, blobName, sizeKb: Math.round(audioBuffer.length / 1024) }
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
