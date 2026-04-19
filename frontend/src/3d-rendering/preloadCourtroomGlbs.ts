import { useGLTF } from '@react-three/drei'
import { GLTFLoader } from 'three-stdlib'
import { peek } from 'suspend-react'
import {
  AVATAR_GLB_ASSETS,
  FURNITURE_GLB_SETTINGS,
  JUDGE_AVATAR_ASSETS_BY_DIFFICULTY,
} from './scenePresets'
import type { JudgeAvatarDifficulty } from './types'

const PRELOAD_TIMEOUT_MS = 120_000
const PRELOAD_POLL_INTERVAL_MS = 120

const preloadCourtroomGlbsPromises = new Map<JudgeAvatarDifficulty, Promise<void>>()

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}

type AssetStatus = 'pending' | 'resolved' | 'failed'

function getCourtroomGlbAssetUrls(judgeDifficulty: JudgeAvatarDifficulty): string[] {
  return Array.from(new Set([
    ...Object.values(FURNITURE_GLB_SETTINGS).map((asset) => asset.url),
    ...Object.values(AVATAR_GLB_ASSETS.counsel),
    ...Object.values(JUDGE_AVATAR_ASSETS_BY_DIFFICULTY[judgeDifficulty] ?? JUDGE_AVATAR_ASSETS_BY_DIFFICULTY.medium),
  ]))
}

function getAssetStatus(assetUrl: string): AssetStatus {
  try {
    const cached = peek([GLTFLoader, assetUrl])
    if (cached === undefined || isPromiseLike(cached)) {
      return 'pending'
    }
    return 'resolved'
  } catch {
    return 'failed'
  }
}

export function preloadCourtroomGlbAssets(
  judgeDifficulty: JudgeAvatarDifficulty = 'medium',
  onProgress?: (loaded: number, total: number) => void
): Promise<void> {
  const existingPromise = preloadCourtroomGlbsPromises.get(judgeDifficulty)
  if (existingPromise) return existingPromise

  const assetUrls = getCourtroomGlbAssetUrls(judgeDifficulty)

  const preloadPromise = (async () => {
    for (const assetUrl of assetUrls) {
      useGLTF.preload(assetUrl)
    }

    const totalAssets = assetUrls.length
    const startedAt = Date.now()
    let previousSettledCount = -1

    while (true) {
      let failedCount = 0
      const settledCount = assetUrls.reduce((count, assetUrl) => {
        const status = getAssetStatus(assetUrl)
        if (status === 'failed') failedCount += 1
        return count + (status === 'pending' ? 0 : 1)
      }, 0)

      if (settledCount !== previousSettledCount) {
        previousSettledCount = settledCount
        onProgress?.(settledCount, totalAssets)
      }

      if (settledCount >= totalAssets) {
        if (failedCount > 0) {
          console.warn(
            `[preloadCourtroomGlbAssets] ${failedCount} asset(s) failed to preload for judge difficulty "${judgeDifficulty}".`
          )
        }
        return
      }

      if (Date.now() - startedAt > PRELOAD_TIMEOUT_MS) {
        console.warn(
          `[preloadCourtroomGlbAssets] Timed out while loading courtroom models (${settledCount}/${totalAssets}) for judge difficulty "${judgeDifficulty}". Continuing without waiting for the remaining assets.`
        )
        onProgress?.(totalAssets, totalAssets)
        return
      }

      await new Promise((resolve) => setTimeout(resolve, PRELOAD_POLL_INTERVAL_MS))
    }
  })()

  preloadCourtroomGlbsPromises.set(judgeDifficulty, preloadPromise)

  return preloadPromise.catch((error) => {
    preloadCourtroomGlbsPromises.delete(judgeDifficulty)
    throw error
  })
}
