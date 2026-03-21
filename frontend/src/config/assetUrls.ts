const rawAssetBaseUrl = import.meta.env.VITE_ASSET_BASE_URL?.trim()
const rawUseS3Assets = import.meta.env.VITE_USE_S3_ASSETS?.trim().toLowerCase()

const USE_S3_ASSETS = rawUseS3Assets === 'true' || rawUseS3Assets === '1' || rawUseS3Assets === 'yes'

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
}

function encodeAssetPath(assetPath: string): string {
  return assetPath
    .replace(/^\/+/, '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

const ASSET_BASE_URL = normalizeBaseUrl(
  USE_S3_ASSETS && rawAssetBaseUrl ? rawAssetBaseUrl : import.meta.env.BASE_URL
)

export function getAssetUrl(assetPath: string): string {
  return `${ASSET_BASE_URL}${encodeAssetPath(assetPath)}`
}

