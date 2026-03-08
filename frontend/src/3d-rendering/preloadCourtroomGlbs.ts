import { useGLTF } from '@react-three/drei'
import { GLTFLoader } from 'three-stdlib'
import { peek } from 'suspend-react'
import {
  AVATAR_GLB_ASSETS,
  FURNITURE_GLB_SETTINGS,
  JUDGE_AVATAR_ASSETS_BY_DIFFICULTY,
} from './scenePresets'

const PRELOAD_TIMEOUT_MS = 120_000
const PRELOAD_POLL_INTERVAL_MS = 120

const COURTROOM_GLB_ASSET_URLS = Array.from(new Set([
  ...Object.values(FURNITURE_GLB_SETTINGS).map((asset) => asset.url),
  ...Object.values(AVATAR_GLB_ASSETS.counsel),
  ...Object.values(JUDGE_AVATAR_ASSETS_BY_DIFFICULTY).flatMap((assetLibrary) => Object.values(assetLibrary)),
]))

let preloadCourtroomGlbsPromise: Promise<void> | null = null

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}

function isAssetResolved(assetUrl: string): boolean {
  const cached = peek([GLTFLoader, assetUrl])
  return cached !== undefined && !isPromiseLike(cached)
}

export function preloadCourtroomGlbAssets(
  onProgress?: (loaded: number, total: number) => void
): Promise<void> {
  if (preloadCourtroomGlbsPromise) return preloadCourtroomGlbsPromise

  preloadCourtroomGlbsPromise = (async () => {
    for (const assetUrl of COURTROOM_GLB_ASSET_URLS) {
      useGLTF.preload(assetUrl)
    }

    const totalAssets = COURTROOM_GLB_ASSET_URLS.length
    const startedAt = Date.now()
    let previousLoadedCount = -1

    while (true) {
      const loadedCount = COURTROOM_GLB_ASSET_URLS.reduce(
        (count, assetUrl) => count + (isAssetResolved(assetUrl) ? 1 : 0),
        0
      )

      if (loadedCount !== previousLoadedCount) {
        previousLoadedCount = loadedCount
        onProgress?.(loadedCount, totalAssets)
      }

      if (loadedCount >= totalAssets) return

      if (Date.now() - startedAt > PRELOAD_TIMEOUT_MS) {
        throw new Error(`Timed out while loading courtroom models (${loadedCount}/${totalAssets})`)
      }

      await new Promise((resolve) => setTimeout(resolve, PRELOAD_POLL_INTERVAL_MS))
    }
  })()

  return preloadCourtroomGlbsPromise.catch((error) => {
    preloadCourtroomGlbsPromise = null
    throw error
  })
}
