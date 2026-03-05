/**
 * AvatarModel Component
 *
 * Renders a Ready Player Me avatar with lip-sync support.
 * Handles sitting pose and morph target animations.
 */

import { useState, useRef, useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { useAnimations, useGLTF } from '@react-three/drei'
import { Lipsync } from 'wawa-lipsync'
import * as THREE from 'three'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { AvatarPoseConfig } from './scenePresets'
import { VISEME_MAP } from './types'

export interface AvatarModelProps {
  url: string
  position: [number, number, number]
  rotation?: [number, number, number]
  scale?: number
  lipsyncManager: Lipsync | null
  isSpeaking: boolean
  label?: string
  sitting?: boolean
  stationary?: boolean
  poseConfig?: AvatarPoseConfig
  playEmbeddedAnimation?: boolean
  animationLoop?: boolean
  animationSpeed?: number
  animationClipName?: string
  freezeAnimationPose?: boolean
  freezeAnimationTime?: number
  freezeAnimationClipName?: string
  animationLibrary?: Record<string, string>
  activeAnimationAssetId?: string
  animationBlendDuration?: number
  onAnimationActionFinished?: (assetId: string) => void
  clipPulseEnabled?: boolean
  clipPulseMovementSpeedScale?: number
  clipPulseMoveDurationRange?: [number, number]
  clipPulseRestDurationRange?: [number, number]
  idleMotionEnabled?: boolean
  idleMotionAmplitude?: number
  idleMotionArmAmplitude?: number
  idleMotionSpeed?: number
}

type AnimationSource = {
  animations?: THREE.AnimationClip[]
}

type AnimationClipEntry = {
  assetId: string
  clip: THREE.AnimationClip
}

const SPEAKING_BONE_TOKENS = ['head', 'neck', 'spine', 'chest', 'upperchest'] as const
const ARM_BONE_TOKENS = ['shoulder', 'clavicle', 'upperarm', 'arm', 'forearm', 'lowerarm', 'elbow'] as const
const HIP_BONE_TOKENS = ['hips', 'pelvis', 'hip'] as const
const THIGH_BONE_TOKENS = ['upleg', 'thigh', 'upperleg'] as const
const CALF_BONE_TOKENS = ['calf', 'lowerleg', 'shin'] as const
const FOOT_BONE_TOKENS = ['foot', 'ankle', 'toe'] as const
const FOREARM_BONE_TOKENS = ['forearm', 'lowerarm'] as const

function normalizeBoneName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function hasAnyToken(name: string, tokens: readonly string[]): boolean {
  return tokens.some((token) => name.includes(token))
}

function isLeftBone(name: string): boolean {
  return name.includes('left')
}

function isRightBone(name: string): boolean {
  return name.includes('right')
}

export function AvatarModel({
  url,
  position,
  rotation = [0, 0, 0],
  scale = 1,
  lipsyncManager,
  isSpeaking,
  sitting = false,
  stationary = false,
  poseConfig,
  playEmbeddedAnimation = false,
  animationLoop = true,
  animationSpeed = 1,
  animationClipName,
  freezeAnimationPose = false,
  freezeAnimationTime = 0,
  freezeAnimationClipName,
  animationLibrary,
  activeAnimationAssetId,
  animationBlendDuration = 0.28,
  onAnimationActionFinished,
  clipPulseEnabled = false,
  clipPulseMovementSpeedScale = 0.24,
  clipPulseMoveDurationRange = [0.7, 1.5],
  clipPulseRestDurationRange = [2.5, 4.8],
  idleMotionEnabled = false,
  idleMotionAmplitude = 0.02,
  idleMotionArmAmplitude = 0.03,
  idleMotionSpeed = 1.1,
}: AvatarModelProps) {
  const baseGltf = useGLTF(url) as unknown as { scene: THREE.Group; animations: THREE.AnimationClip[] }
  const { scene, animations: baseAnimations } = baseGltf
  const groupRef = useRef<THREE.Group>(null)
  const [morphTargetMeshes, setMorphTargetMeshes] = useState<THREE.SkinnedMesh[]>([])
  const [speakingBones, setSpeakingBones] = useState<THREE.Bone[]>([])
  const [idleArmBones, setIdleArmBones] = useState<THREE.Bone[]>([])
  const speakingBoneBaseRotationsRef = useRef<Map<THREE.Bone, THREE.Euler>>(new Map())
  const activeActionRef = useRef<THREE.AnimationAction | null>(null)
  const currentAnimationSpeedRef = useRef(animationSpeed)
  const loggedBoneMatchWarningRef = useRef(false)
  const clipPulseRuntimeRef = useRef<{ initialized: boolean; moving: boolean; nextSwitchAt: number }>({
    initialized: false,
    moving: false,
    nextSwitchAt: 0,
  })

  const animationSourceEntries = useMemo<Array<[string, string]>>(() => {
    const libraryEntries = animationLibrary ? Object.entries(animationLibrary) : []
    const entries: Array<[string, string]> = [...libraryEntries]
    if (!entries.some(([, sourceUrl]) => sourceUrl === url)) {
      entries.unshift(['__base__', url])
    }
    return entries
  }, [animationLibrary, url])

  const animationSourceUrls = useMemo(
    () => animationSourceEntries.map(([, sourceUrl]) => sourceUrl),
    [animationSourceEntries]
  )

  const rawAnimationSources = useGLTF(animationSourceUrls) as unknown
  const animationSources = useMemo<AnimationSource[]>(() => {
    if (Array.isArray(rawAnimationSources)) {
      return rawAnimationSources as AnimationSource[]
    }
    return [rawAnimationSources as AnimationSource]
  }, [rawAnimationSources])

  const animationClipEntries = useMemo<AnimationClipEntry[]>(() => {
    const entries: AnimationClipEntry[] = []
    animationSourceEntries.forEach(([assetId], sourceIndex) => {
      const source = animationSources[sourceIndex]
      const sourceClips = source?.animations ?? []
      sourceClips.forEach((sourceClip, clipIndex) => {
        const clonedClip = sourceClip.clone()
        const rawClipName = sourceClip.name.trim().length > 0 ? sourceClip.name : `clip_${clipIndex}`
        clonedClip.name = `${assetId}::${rawClipName}`
        entries.push({ assetId, clip: clonedClip })
      })
    })

    if (entries.length === 0) {
      baseAnimations.forEach((clip, clipIndex) => {
        const clonedClip = clip.clone()
        const rawClipName = clip.name.trim().length > 0 ? clip.name : `clip_${clipIndex}`
        clonedClip.name = `__base__::${rawClipName}`
        entries.push({ assetId: '__base__', clip: clonedClip })
      })
    }

    return entries
  }, [animationSourceEntries, animationSources, baseAnimations])

  const mergedAnimations = useMemo(
    () => animationClipEntries.map((entry) => entry.clip),
    [animationClipEntries]
  )

  const clipNamesByAssetId = useMemo(() => {
    const namesByAssetId = new Map<string, string[]>()
    animationClipEntries.forEach((entry) => {
      const existing = namesByAssetId.get(entry.assetId)
      if (existing) {
        existing.push(entry.clip.name)
      } else {
        namesByAssetId.set(entry.assetId, [entry.clip.name])
      }
    })
    return namesByAssetId
  }, [animationClipEntries])

  const { actions, names, mixer } = useAnimations(mergedAnimations, groupRef)
  const hasEmbeddedClips = names.length > 0 && Object.values(actions).some((action) => Boolean(action))
  const stateDrivenAnimationEnabled = Boolean(
    activeAnimationAssetId && clipNamesByAssetId.has(activeAnimationAssetId)
  )
  const usesActiveAnimation = stateDrivenAnimationEnabled || playEmbeddedAnimation

  // Default pose values (can be overridden by poseConfig)
  const pose = poseConfig || {
    hipTiltX: 0.15,
    hipOffsetY: 1.30,
    thighRotationX: Math.PI / 2,
    calfRotationX: Math.PI / 2,
    footRotationX: 0,
    spineLeanX: -0.05,
    leftUpperArmRotationZ: -1.2,
    rightUpperArmRotationZ: 1.2,
    leftElbowRotationX: 0.25,
    rightElbowRotationX: 0.25,
    leftElbowRotationZ: 0,
    rightElbowRotationZ: 0,
  }
  
  // Clone the scene using SkeletonUtils for proper skinned mesh cloning
  const clonedScene = useMemo(() => {
    const cloneFn = (SkeletonUtils as { clone?: (source: THREE.Object3D) => THREE.Object3D }).clone
    if (cloneFn) {
      return cloneFn(scene) as THREE.Group
    }
    return scene.clone(true)
  }, [scene])

  // Find all meshes with morph targets in the cloned scene and apply sitting pose.
  useEffect(() => {
    const meshes: THREE.SkinnedMesh[] = []
    const trackedSpeakingBones: THREE.Bone[] = []
    const trackedIdleArmBones: THREE.Bone[] = []
    const baseRotations = new Map<THREE.Bone, THREE.Euler>()

    clonedScene.traverse((child) => {
      // Disable frustum culling for ALL objects to prevent disappearing during animations
      if ('frustumCulled' in child) {
        child.frustumCulled = false
      }

      if (child instanceof THREE.Mesh || child instanceof THREE.SkinnedMesh) {
        child.frustumCulled = false

        if (child.geometry) {
          child.geometry.computeBoundingSphere()
          if (child.geometry.boundingSphere) {
            child.geometry.boundingSphere.radius *= 3
          }
        }
      }

      if (child instanceof THREE.SkinnedMesh && child.morphTargetDictionary && child.morphTargetInfluences) {
        meshes.push(child)
      }

      if (child instanceof THREE.Bone) {
        const boneName = normalizeBoneName(child.name)
        if (hasAnyToken(boneName, SPEAKING_BONE_TOKENS)) {
          trackedSpeakingBones.push(child)
          baseRotations.set(child, child.rotation.clone())
        }
        if (hasAnyToken(boneName, ARM_BONE_TOKENS) && !boneName.includes('hand')) {
          trackedIdleArmBones.push(child)
          if (!baseRotations.has(child)) {
            baseRotations.set(child, child.rotation.clone())
          }
        }
      }

      // Apply sitting pose by rotating skeleton bones.
      // Skip this when an embedded animation is active to avoid pose conflicts.
      if (sitting && !usesActiveAnimation && !(freezeAnimationPose && hasEmbeddedClips) && child instanceof THREE.Bone) {
        const boneName = normalizeBoneName(child.name)

        if (hasAnyToken(boneName, HIP_BONE_TOKENS)) {
          child.rotation.x = pose.hipTiltX
        }
        if (hasAnyToken(boneName, THIGH_BONE_TOKENS)) {
          child.rotation.z = 0
          child.rotation.x = pose.thighRotationX
        }
        if (
          (boneName.includes('leg') || hasAnyToken(boneName, CALF_BONE_TOKENS)) &&
          (isLeftBone(boneName) || isRightBone(boneName)) &&
          !boneName.includes('up') &&
          !boneName.includes('upper') &&
          !boneName.includes('thigh')
        ) {
          child.rotation.z = 0
          child.rotation.x = pose.calfRotationX
        }
        if (hasAnyToken(boneName, FOOT_BONE_TOKENS)) {
          child.rotation.z = 0
          child.rotation.x = pose.footRotationX
        }
        if (boneName.includes('spine')) {
          child.rotation.x = pose.spineLeanX
        }
        if (
          boneName.includes('arm') &&
          (boneName.includes('upper') || !boneName.includes('fore')) &&
          !boneName.includes('hand')
        ) {
          if (isLeftBone(boneName)) {
            child.rotation.z = pose.leftUpperArmRotationZ
          } else if (isRightBone(boneName)) {
            child.rotation.z = pose.rightUpperArmRotationZ
          }
        }
        if (hasAnyToken(boneName, FOREARM_BONE_TOKENS) && !boneName.includes('hand')) {
          if (isLeftBone(boneName)) {
            child.rotation.x = pose.leftElbowRotationX
            child.rotation.z = pose.leftElbowRotationZ
          } else if (isRightBone(boneName)) {
            child.rotation.x = pose.rightElbowRotationX
            child.rotation.z = pose.rightElbowRotationZ
          }
        }
      }
    })

    setMorphTargetMeshes(meshes)
    setSpeakingBones(trackedSpeakingBones)
    setIdleArmBones(trackedIdleArmBones)
    speakingBoneBaseRotationsRef.current = baseRotations

    if (!loggedBoneMatchWarningRef.current && (trackedSpeakingBones.length === 0 || trackedIdleArmBones.length === 0)) {
      console.warn('[AvatarModel] Limited bone matches for idle/talk fallback.', {
        url,
        speakingBoneMatches: trackedSpeakingBones.length,
        idleArmBoneMatches: trackedIdleArmBones.length,
      })
      loggedBoneMatchWarningRef.current = true
    }
  }, [clonedScene, sitting, pose, usesActiveAnimation, freezeAnimationPose, hasEmbeddedClips, url])

  useEffect(() => {
    currentAnimationSpeedRef.current = animationSpeed
  }, [animationSpeed])

  useEffect(() => {
    loggedBoneMatchWarningRef.current = false
  }, [url])

  useEffect(() => {
    clipPulseRuntimeRef.current = {
      initialized: false,
      moving: false,
      nextSwitchAt: 0,
    }
  }, [clipPulseEnabled, activeAnimationAssetId, url, isSpeaking])

  useEffect(() => {
    const allActions = Object.values(actions).filter(
      (action): action is THREE.AnimationAction => Boolean(action)
    )

    const resolveActionByAssetId = (assetId: string | undefined): THREE.AnimationAction | undefined => {
      if (!assetId) return undefined
      const candidateNames = clipNamesByAssetId.get(assetId)
      if (!candidateNames || candidateNames.length === 0) return undefined
      return actions[candidateNames[0]]
    }

    if (!usesActiveAnimation && !freezeAnimationPose) {
      allActions.forEach((action) => action?.stop())
      activeActionRef.current = null
      clipPulseRuntimeRef.current = {
        initialized: false,
        moving: false,
        nextSwitchAt: 0,
      }
      return
    }

    if (freezeAnimationPose && !hasEmbeddedClips) {
      allActions.forEach((action) => action?.stop())
      activeActionRef.current = null
      clipPulseRuntimeRef.current = {
        initialized: false,
        moving: false,
        nextSwitchAt: 0,
      }
      return
    }

    let selectedAction: THREE.AnimationAction | undefined
    if (stateDrivenAnimationEnabled) {
      selectedAction = resolveActionByAssetId(activeAnimationAssetId)
    }

    if (!selectedAction) {
      const clipName = usesActiveAnimation ? animationClipName : freezeAnimationClipName
      const selectedName = clipName && actions[clipName] ? clipName : names[0]
      selectedAction = selectedName ? actions[selectedName] : undefined
    }

    if (!selectedAction) return

    const previousAction = activeActionRef.current
    selectedAction.reset()
    selectedAction.enabled = true
    selectedAction.setEffectiveWeight(1)

    let onFinished: ((event: THREE.Event & { action?: THREE.AnimationAction }) => void) | null = null
    const selectedAssetId = stateDrivenAnimationEnabled && activeAnimationAssetId ? activeAnimationAssetId : null

    if (usesActiveAnimation) {
      selectedAction.setEffectiveTimeScale(animationSpeed)
      selectedAction.setLoop(animationLoop ? THREE.LoopRepeat : THREE.LoopOnce, animationLoop ? Infinity : 1)
      selectedAction.clampWhenFinished = !animationLoop
      selectedAction.play()

      if (previousAction && previousAction !== selectedAction) {
        selectedAction.crossFadeFrom(previousAction, Math.max(0.01, animationBlendDuration), true)
      }

      allActions.forEach((action) => {
        if (action !== selectedAction && action !== previousAction) {
          action.stop()
        }
      })

      activeActionRef.current = selectedAction
      clipPulseRuntimeRef.current = {
        initialized: false,
        moving: false,
        nextSwitchAt: 0,
      }

      if (!animationLoop && selectedAssetId && onAnimationActionFinished) {
        onFinished = (event: THREE.Event & { action?: THREE.AnimationAction }) => {
          if (event.action === selectedAction) {
            onAnimationActionFinished(selectedAssetId)
          }
        }
        mixer.addEventListener('finished', onFinished)
      }
    } else {
      const freezeTime = Math.max(0, freezeAnimationTime)
      const clipDuration = selectedAction.getClip().duration
      const freezeTimeClamped =
        clipDuration > 0 ? Math.min(freezeTime, Math.max(clipDuration - 0.001, 0)) : freezeTime

      selectedAction.setLoop(THREE.LoopOnce, 1)
      selectedAction.clampWhenFinished = true
      selectedAction.play()
      mixer.update(0)
      selectedAction.time = freezeTimeClamped
      selectedAction.setEffectiveTimeScale(0)
      selectedAction.paused = true
      mixer.update(0)
      activeActionRef.current = selectedAction
      clipPulseRuntimeRef.current = {
        initialized: false,
        moving: false,
        nextSwitchAt: 0,
      }
    }

    return () => {
      if (onFinished) {
        mixer.removeEventListener('finished', onFinished)
      }
    }
  }, [
    actions,
    clipNamesByAssetId,
    stateDrivenAnimationEnabled,
    activeAnimationAssetId,
    usesActiveAnimation,
    names,
    animationLoop,
    animationSpeed,
    animationClipName,
    animationBlendDuration,
    freezeAnimationPose,
    freezeAnimationTime,
    freezeAnimationClipName,
    hasEmbeddedClips,
    mixer,
    onAnimationActionFinished,
  ])

  // Animate lip sync
  useFrame((state) => {
    const activeAction = activeActionRef.current
    const randomBetween = (min: number, max: number) => min + Math.random() * Math.max(max - min, 0)

    if (activeAction && usesActiveAnimation) {
      if (clipPulseEnabled && !isSpeaking && animationLoop) {
        const pulseRuntime = clipPulseRuntimeRef.current
        const elapsed = state.clock.elapsedTime

        if (!pulseRuntime.initialized) {
          pulseRuntime.initialized = true
          pulseRuntime.moving = false
          pulseRuntime.nextSwitchAt = elapsed + randomBetween(clipPulseRestDurationRange[0], clipPulseRestDurationRange[1])
        } else if (elapsed >= pulseRuntime.nextSwitchAt) {
          pulseRuntime.moving = !pulseRuntime.moving
          pulseRuntime.nextSwitchAt =
            elapsed +
            (pulseRuntime.moving
              ? randomBetween(clipPulseMoveDurationRange[0], clipPulseMoveDurationRange[1])
              : randomBetween(clipPulseRestDurationRange[0], clipPulseRestDurationRange[1]))
        }

        const pulseSpeed = pulseRuntime.moving
          ? currentAnimationSpeedRef.current * clipPulseMovementSpeedScale
          : 0
        const currentSpeed = activeAction.getEffectiveTimeScale()
        const lerpAlpha = pulseRuntime.moving ? 0.14 : 0.08
        activeAction.setEffectiveTimeScale(THREE.MathUtils.lerp(currentSpeed, pulseSpeed, lerpAlpha))
      } else {
        const pulseRuntime = clipPulseRuntimeRef.current
        pulseRuntime.initialized = false
        pulseRuntime.moving = false
        pulseRuntime.nextSwitchAt = 0

        const currentSpeed = activeAction.getEffectiveTimeScale()
        const targetSpeed = currentAnimationSpeedRef.current
        activeAction.setEffectiveTimeScale(THREE.MathUtils.lerp(currentSpeed, targetSpeed, 0.16))
      }
    }

    if (!lipsyncManager || !isSpeaking || morphTargetMeshes.length === 0) {
      // Reset all visemes when not speaking
      morphTargetMeshes.forEach((mesh) => {
        if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
          Object.values(VISEME_MAP).forEach((visemeName) => {
            const index = mesh.morphTargetDictionary![visemeName]
            if (index !== undefined) {
              mesh.morphTargetInfluences![index] = THREE.MathUtils.lerp(
                mesh.morphTargetInfluences![index],
                0,
                0.1
              )
            }
          })
        }
      })
    } else {
      try {
        lipsyncManager.processAudio()
      } catch (_error) {
        return
      }

      const currentViseme = lipsyncManager.viseme
      const visemeName = VISEME_MAP[currentViseme] || 'viseme_sil'
      const rawIntensity = (lipsyncManager as { volume?: number }).volume

      let intensity = 0
      if (typeof rawIntensity === 'number' && Number.isFinite(rawIntensity)) {
        intensity = Math.max(0, Math.min(rawIntensity * 1.2, 0.5))
      }

      morphTargetMeshes.forEach((mesh) => {
        if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
          Object.values(VISEME_MAP).forEach((name) => {
            const index = mesh.morphTargetDictionary![name]
            if (index !== undefined) {
              const targetValue = name === visemeName ? intensity : 0
              mesh.morphTargetInfluences![index] = THREE.MathUtils.lerp(
                mesh.morphTargetInfluences![index],
                targetValue,
                0.25
              )
            }
          })
        }
      })
    }

    // Fallback speaking animation when no visemes are available in the mesh.
    if (speakingBones.length > 0) {
      const elapsed = state.clock.elapsedTime
      const idlePulseGate = clipPulseEnabled ? (clipPulseRuntimeRef.current.moving ? 1 : 0) : 1
      speakingBones.forEach((bone, index) => {
        const baseRotation = speakingBoneBaseRotationsRef.current.get(bone)
        if (!baseRotation) return

        const boneName = normalizeBoneName(bone.name)
        const isHead = boneName.includes('head')
        const isNeck = boneName.includes('neck')
        const talkAmplitude = isHead ? 0.03 : isNeck ? 0.02 : 0.01
        const talkCadence = isHead ? 8 : 6
        const talkWobble = isSpeaking ? Math.sin(elapsed * talkCadence + index * 0.5) * talkAmplitude : 0
        const idleWobble =
          !isSpeaking && idleMotionEnabled
            ? Math.sin(elapsed * idleMotionSpeed + index * 0.55) * idleMotionAmplitude * idlePulseGate
            : 0
        const targetX = baseRotation.x + talkWobble + idleWobble
        const targetY =
          !isSpeaking && idleMotionEnabled && isHead
            ? baseRotation.y + Math.sin(elapsed * (idleMotionSpeed * 0.7) + index) * idleMotionAmplitude * 0.28 * idlePulseGate
            : baseRotation.y
        const settleLerp = isSpeaking ? 0.22 : idleMotionEnabled ? 0.1 : 0.12

        bone.rotation.x = THREE.MathUtils.lerp(bone.rotation.x, targetX, settleLerp)
        bone.rotation.y = THREE.MathUtils.lerp(bone.rotation.y, targetY, 0.1)
        bone.rotation.z = THREE.MathUtils.lerp(bone.rotation.z, baseRotation.z, 0.1)
      })
    }

    if (idleArmBones.length > 0) {
      const elapsed = state.clock.elapsedTime
      const idlePulseGate = clipPulseEnabled ? (clipPulseRuntimeRef.current.moving ? 1 : 0) : 1
      idleArmBones.forEach((bone, index) => {
        const baseRotation = speakingBoneBaseRotationsRef.current.get(bone)
        if (!baseRotation) return

        const boneName = normalizeBoneName(bone.name)
        const side = isLeftBone(boneName) ? 1 : isRightBone(boneName) ? -1 : 1
        const active =
          !isSpeaking &&
          idleMotionEnabled &&
          !boneName.includes('hand') &&
          hasAnyToken(boneName, ARM_BONE_TOKENS)

        const swingZ = active
          ? Math.sin(elapsed * (idleMotionSpeed * 0.55) + index * 0.8) * idleMotionArmAmplitude * side * idlePulseGate
          : 0
        const swingX = active
          ? Math.sin(elapsed * (idleMotionSpeed * 0.38) + index * 0.6) * idleMotionArmAmplitude * 0.35 * idlePulseGate
          : 0

        bone.rotation.z = THREE.MathUtils.lerp(bone.rotation.z, baseRotation.z + swingZ, active ? 0.09 : 0.12)
        bone.rotation.x = THREE.MathUtils.lerp(bone.rotation.x, baseRotation.x + swingX, active ? 0.09 : 0.12)
      })
    }
  })

  useEffect(() => {
    return () => {
      Object.values(actions).forEach((action) => action?.stop())
    }
  }, [actions])

  // Subtle idle animation (breathing)
  useFrame((state) => {
    if (groupRef.current && !stationary) {
      const baseY = position[1]
      groupRef.current.position.y = baseY + Math.sin(state.clock.elapsedTime * 0.5) * 0.005
    }
  })

  return (
    <group
      ref={groupRef}
      position={position}
      rotation={rotation.map((angleDegrees) => angleDegrees * Math.PI / 180) as [number, number, number]}
      scale={scale}
    >
      <primitive object={clonedScene} />
    </group>
  )
}
