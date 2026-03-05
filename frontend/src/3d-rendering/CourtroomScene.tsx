/**
 * CourtroomScene Component
 *
 * Main 3D canvas wrapper containing the courtroom environment,
 * avatars, lighting, and camera controls.
 */

import { Suspense, useEffect, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Environment, useGLTF } from '@react-three/drei'
import { Lipsync } from 'wawa-lipsync'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import {
  AVATAR_GLB_ASSETS,
  AVATAR_RUNTIME_SETTINGS,
  AVATAR_SCENE_SETTINGS,
  FURNITURE_GLB_SETTINGS,
  JUDGE_AVATAR_ASSETS_BY_DIFFICULTY,
  SCENE_PRESETS,
  getAvatarAssetLibrary,
  getAvatarRenderState,
  getActiveAvatarUrl,
  type AvatarRole,
  type SceneConfig,
} from './scenePresets'
import { Courtroom } from './Courtroom'
import { AvatarModel } from './AvatarModel'
import { JudgeEntranceSequence } from './JudgeEntranceSequence'
import type { JudgeAvatarDifficulty, SpeakingRole } from './types'

const SCENE_CONFIG: SceneConfig = SCENE_PRESETS.default
const LAYOUT = SCENE_CONFIG.layout
const COURTROOM_CONFIG = {
  scale: SCENE_CONFIG.sceneScale,
  judgeBench: SCENE_CONFIG.judgeBench,
  counselTables: SCENE_CONFIG.counselTables,
}
const AVATAR_SCALE =
  SCENE_CONFIG.avatars.scale * AVATAR_SCENE_SETTINGS.baseScaleMultiplier * AVATAR_SCENE_SETTINGS.globalScaleMultiplier
const JUDGE_AVATAR_CONFIG = SCENE_CONFIG.avatars.judge
const COUNSEL_AVATAR_CONFIG = SCENE_CONFIG.avatars.counsel
const JUDGE_RUNTIME = AVATAR_RUNTIME_SETTINGS.judge
const COUNSEL_RUNTIME = AVATAR_RUNTIME_SETTINGS.counsel
const WINDOW_GLB = FURNITURE_GLB_SETTINGS.window
const JUDGE_SCALE = AVATAR_SCALE * JUDGE_RUNTIME.scaleMultiplier
const COUNSEL_SCALE = AVATAR_SCALE * COUNSEL_RUNTIME.scaleMultiplier
const JUDGE_SEAT_Y = SCENE_CONFIG.judgeBench.tiers.tier1.height + SCENE_CONFIG.judgeBench.chair.seatHeight
const COUNSEL_SEAT_Y = SCENE_CONFIG.counselTables.chairSeatHeight
const ROOM = SCENE_CONFIG.room
const SIDE_WALL_LENGTH = ROOM.backWall - ROOM.frontWall
const SIDE_WINDOW_Z_POSITIONS = [
  ROOM.frontWall + SIDE_WALL_LENGTH / 3 + WINDOW_GLB.positionOffset[0],
  ROOM.frontWall + (2 * SIDE_WALL_LENGTH) / 3 + WINDOW_GLB.positionOffset[0],
] as const
const WINDOW_LIGHT_HEIGHT = ROOM.height * 0.42
const WINDOW_LIGHT_INSET = ROOM.wallThickness + 0.45
const JUDGE_POSE_CONFIG = { ...JUDGE_AVATAR_CONFIG.pose, ...JUDGE_RUNTIME.poseOverride }
const COUNSEL_POSE_CONFIG = { ...COUNSEL_AVATAR_CONFIG.pose, ...COUNSEL_RUNTIME.poseOverride }
const JUDGE_RENDER_STATE = getAvatarRenderState('judge')
const COUNSEL_RENDER_STATE = getAvatarRenderState('counsel')
const JUDGE_CHAIR_POSITION: [number, number, number] = [
  JUDGE_AVATAR_CONFIG.offsetX + JUDGE_RUNTIME.positionOffset[0],
  JUDGE_SEAT_Y + JUDGE_AVATAR_CONFIG.offsetY + JUDGE_RUNTIME.positionOffset[1],
  LAYOUT.judgeBench + COURTROOM_CONFIG.judgeBench.chair.zOffset + JUDGE_AVATAR_CONFIG.offsetZ + JUDGE_RUNTIME.positionOffset[2],
]
const JUDGE_ENTRANCE_START_POSITION: [number, number, number] = [0, 0.02, SCENE_CONFIG.room.backWall - 0.9]
const JUDGE_ENTRANCE_APPROACH_POSITION: [number, number, number] = [
  JUDGE_CHAIR_POSITION[0],
  0.02,
  JUDGE_CHAIR_POSITION[2] + 1.25,
]
const COUNSEL_AVATAR_URL = getActiveAvatarUrl('counsel')

export const COURTROOM_ANIMATION_STATE_OPTIONS = {
  judge: ['seatedIdle', 'seatedTalk', 'clap', 'cheer', 'sitTransition', 'walk', 'run'] as const,
  counsel: ['seatedIdle', 'seatedTalk', 'clap', 'cheer', 'doze', 'sitToStand', 'walk', 'run'] as const,
}

export type AvatarAnimationStateKey =
  | (typeof COURTROOM_ANIMATION_STATE_OPTIONS.judge)[number]
  | (typeof COURTROOM_ANIMATION_STATE_OPTIONS.counsel)[number]

type AnimationStateDefinition = {
  assetId?: string
  loop?: boolean
  speed?: number
  overrideSitting?: boolean
  overrideStationary?: boolean
}

const JUDGE_ANIMATION_STATES: Record<(typeof COURTROOM_ANIMATION_STATE_OPTIONS.judge)[number], AnimationStateDefinition> = {
  seatedIdle: {
    assetId: 'seatedAnswering',
    loop: true,
    speed: 1,
    overrideSitting: true,
    overrideStationary: true,
  },
  seatedTalk: {
    assetId: 'seatedAnswering',
    loop: true,
    speed: 1.08,
    overrideSitting: true,
    overrideStationary: true,
  },
  clap: {
    assetId: 'clap',
    loop: false,
    speed: 1,
    overrideSitting: true,
    overrideStationary: true,
  },
  cheer: {
    assetId: 'sitCheer',
    loop: false,
    speed: 1,
    overrideSitting: true,
    overrideStationary: true,
  },
  sitTransition: {
    assetId: 'sitTransition',
    loop: false,
    speed: 1,
    overrideSitting: false,
    overrideStationary: false,
  },
  walk: {
    assetId: 'walking',
    loop: true,
    speed: 1,
    overrideSitting: false,
    overrideStationary: false,
  },
  run: {
    assetId: 'running',
    loop: true,
    speed: 1,
    overrideSitting: false,
    overrideStationary: false,
  },
}

const COUNSEL_ANIMATION_STATES: Record<(typeof COURTROOM_ANIMATION_STATE_OPTIONS.counsel)[number], AnimationStateDefinition> = {
  seatedIdle: {
    assetId: 'seatedAnswering',
    loop: true,
    speed: 1,
    overrideSitting: true,
    overrideStationary: true,
  },
  seatedTalk: {
    assetId: 'seatedAnswering',
    loop: true,
    speed: 1.05,
    overrideSitting: true,
    overrideStationary: true,
  },
  clap: {
    assetId: 'clap',
    loop: false,
    speed: 1,
    overrideSitting: true,
    overrideStationary: true,
  },
  cheer: {
    assetId: 'sitCheer',
    loop: false,
    speed: 1,
    overrideSitting: true,
    overrideStationary: true,
  },
  doze: {
    assetId: 'sitDoze',
    loop: true,
    speed: 1,
    overrideSitting: true,
    overrideStationary: true,
  },
  sitToStand: {
    assetId: 'sitToStand',
    loop: false,
    speed: 1,
    overrideSitting: false,
    overrideStationary: false,
  },
  walk: {
    assetId: 'walking',
    loop: true,
    speed: 1,
    overrideSitting: false,
    overrideStationary: false,
  },
  run: {
    assetId: 'running',
    loop: true,
    speed: 1,
    overrideSitting: false,
    overrideStationary: false,
  },
}

interface CameraShot {
  position: [number, number, number]
  target: [number, number, number]
  orbitYawOffset: number
  orbitPitchOffset: number
  minPolar: number
  maxPolar: number
  minAzimuth: number
  maxAzimuth: number
  autoRotate: boolean
  autoRotateSpeed: number
}

const PRIMARY_CAMERA_SHOT: CameraShot = {
  position: SCENE_CONFIG.camera.position,
  target: SCENE_CONFIG.camera.target,
  orbitYawOffset: SCENE_CONFIG.camera.orbitYawOffset,
  orbitPitchOffset: SCENE_CONFIG.camera.orbitPitchOffset,
  minPolar: SCENE_CONFIG.camera.minPolarAngle,
  maxPolar: SCENE_CONFIG.camera.maxPolarAngle,
  minAzimuth: SCENE_CONFIG.camera.minAzimuthAngle,
  maxAzimuth: SCENE_CONFIG.camera.maxAzimuthAngle,
  autoRotate: false,
  autoRotateSpeed: 0,
}

export interface CourtroomSceneProps {
  speakingRole: SpeakingRole
  lipsyncManager: Lipsync | null
  orbitControlsRef: React.MutableRefObject<OrbitControlsImpl | null>
  judgeDifficulty?: JudgeAvatarDifficulty
  showJudgeEntrance?: boolean
  animationSpeakingRole?: SpeakingRole
  animationBlendDuration?: number
  animationStateOverrides?: Partial<Record<AvatarRole, AvatarAnimationStateKey | null>>
  onAnimationStateFinished?: (role: AvatarRole, state: AvatarAnimationStateKey) => void
}

function LoadingAvatar() {
  return (
    <mesh>
      <sphereGeometry args={[0.3, 24, 24]} />
      <meshStandardMaterial color="#3f6a9f" wireframe />
    </mesh>
  )
}

function CinematicCameraRig({
  controlsRef,
}: {
  controlsRef: React.RefObject<OrbitControlsImpl>
}) {
  const initializedRef = useRef(false)

  useFrame(({ camera }) => {
    const controls = controlsRef.current
    if (!controls) return

    const shot = PRIMARY_CAMERA_SHOT

    controls.minPolarAngle = shot.minPolar
    controls.maxPolarAngle = shot.maxPolar
    controls.minAzimuthAngle = shot.minAzimuth
    controls.maxAzimuthAngle = shot.maxAzimuth
    controls.autoRotate = shot.autoRotate
    controls.autoRotateSpeed = shot.autoRotateSpeed

    if (!initializedRef.current) {
      const target = new THREE.Vector3(...shot.target)
      const initialPosition = new THREE.Vector3(...shot.position)
      const spherical = new THREE.Spherical().setFromVector3(initialPosition.clone().sub(target))

      spherical.theta += shot.orbitYawOffset
      spherical.phi = THREE.MathUtils.clamp(
        spherical.phi + shot.orbitPitchOffset,
        0.001,
        Math.PI - 0.001
      )

      const adjustedPosition = new THREE.Vector3().setFromSpherical(spherical).add(target)
      camera.position.copy(adjustedPosition)
      controls.target.copy(target)
      initializedRef.current = true
    }

    // Keep the camera anchored in place while still allowing look-around rotation.
    const distanceToTarget = camera.position.distanceTo(controls.target)
    controls.minDistance = Math.max(distanceToTarget - 0.05, 0.01)
    controls.maxDistance = distanceToTarget + 0.05
    controls.update()
  })

  return null
}

function KeyboardCameraControls({ controlsRef }: { controlsRef: React.RefObject<OrbitControlsImpl> }) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!controlsRef.current) return

      const rotateAmount = 0.08
      const controls = controlsRef.current

      switch (e.key) {
        case 'ArrowLeft':
          controls.setAzimuthalAngle(controls.getAzimuthalAngle() + rotateAmount)
          controls.update()
          break
        case 'ArrowRight':
          controls.setAzimuthalAngle(controls.getAzimuthalAngle() - rotateAmount)
          controls.update()
          break
        case 'ArrowUp':
          controls.setPolarAngle(Math.max(controls.getPolarAngle() - rotateAmount, Math.PI / 4))
          controls.update()
          break
        case 'ArrowDown':
          controls.setPolarAngle(Math.min(controls.getPolarAngle() + rotateAmount, Math.PI / 1.6))
          controls.update()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [controlsRef])

  return null
}

export function CourtroomScene({
  speakingRole,
  lipsyncManager,
  orbitControlsRef,
  judgeDifficulty = 'medium',
  showJudgeEntrance = false,
  animationSpeakingRole,
  animationBlendDuration = 0.28,
  animationStateOverrides,
  onAnimationStateFinished,
}: CourtroomSceneProps) {
  const selectedJudgeDifficulty: JudgeAvatarDifficulty =
    judgeDifficulty === 'easy' || judgeDifficulty === 'hard' ? judgeDifficulty : 'medium'
  const judgeAvatarLibrary = getAvatarAssetLibrary('judge', selectedJudgeDifficulty)
  const judgeAvatarUrl = getActiveAvatarUrl('judge', selectedJudgeDifficulty)
  const judgeEntranceWalkUrl = judgeAvatarLibrary.walking ?? judgeAvatarUrl
  const judgeEntranceSitTransitionUrl = judgeAvatarLibrary.sitTransition ?? judgeAvatarUrl
  const judgeEntranceSeatedIdleUrl = judgeAvatarLibrary.seatedAnswering ?? judgeAvatarUrl
  const roleForAnimation = animationSpeakingRole ?? speakingRole

  const judgeAnimationState =
    animationStateOverrides?.judge ?? (roleForAnimation === 'judge' ? 'seatedTalk' : 'seatedIdle')
  const counselAnimationState =
    animationStateOverrides?.counsel ?? (roleForAnimation === 'counsel' ? 'seatedTalk' : 'seatedIdle')

  const judgeAnimationConfig =
    JUDGE_ANIMATION_STATES[judgeAnimationState as keyof typeof JUDGE_ANIMATION_STATES] ?? JUDGE_ANIMATION_STATES.seatedIdle
  const counselAnimationConfig =
    COUNSEL_ANIMATION_STATES[counselAnimationState as keyof typeof COUNSEL_ANIMATION_STATES] ??
    COUNSEL_ANIMATION_STATES.seatedIdle

  const judgeSitting = judgeAnimationConfig.overrideSitting ?? JUDGE_RENDER_STATE.sitting
  const judgeStationary = judgeAnimationConfig.overrideStationary ?? JUDGE_RENDER_STATE.stationary
  const counselSitting = counselAnimationConfig.overrideSitting ?? COUNSEL_RENDER_STATE.sitting
  const counselStationary = counselAnimationConfig.overrideStationary ?? COUNSEL_RENDER_STATE.stationary
  const judgeUsesClip = Boolean(judgeAnimationConfig.assetId)
  const counselUsesClip = Boolean(counselAnimationConfig.assetId)
  const judgeAnimationLoop = judgeAnimationConfig.loop ?? true
  const counselAnimationLoop = counselAnimationConfig.loop ?? true
  const judgeAnimationSpeed = judgeAnimationConfig.speed ?? 1
  const counselAnimationSpeed = counselAnimationConfig.speed ?? 1

  return (
    <Canvas
      camera={{
        position: PRIMARY_CAMERA_SHOT.position,
        fov: SCENE_CONFIG.camera.fov,
      }}
      shadows="soft"
      dpr={[1, 1.5]}
      style={{ background: 'radial-gradient(circle at top, #2f2a22 0%, #14120f 55%, #0b0907 100%)' }}
      gl={{
        antialias: true,
        powerPreference: 'high-performance',
        stencil: false,
      }}
    >
      <fog attach="fog" args={['#1c1711', 7, 17]} />

      <ambientLight intensity={0.32} color="#f7ecdb" />
      <hemisphereLight intensity={0.52} color="#bddcff" groundColor="#251d14" />

      <directionalLight
        position={[0, 6, -2]}
        intensity={0.85}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-far={16}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
        shadow-bias={-0.0008}
        color="#fff3dd"
      />

      <pointLight position={[-6, 3.8, -5]} intensity={0.35} color="#ffd9a1" />
      <pointLight position={[6, 3.8, -5]} intensity={0.35} color="#ffd9a1" />
      <spotLight position={[0, 5.1, 1.2]} angle={0.52} penumbra={0.45} intensity={0.95} color="#ffe7bf" />

      <Suspense fallback={<LoadingAvatar />}>
        <group scale={[COURTROOM_CONFIG.scale, COURTROOM_CONFIG.scale, COURTROOM_CONFIG.scale]}>
          {SIDE_WINDOW_Z_POSITIONS.map((windowZ, index) => (
            <group key={`window-daylight-${index}`}>
              <pointLight
                position={[ROOM.leftWall + WINDOW_LIGHT_INSET, WINDOW_LIGHT_HEIGHT, windowZ]}
                intensity={0.95}
                distance={7}
                decay={2}
                color="#8fc9ff"
              />
              <pointLight
                position={[ROOM.rightWall - WINDOW_LIGHT_INSET, WINDOW_LIGHT_HEIGHT, windowZ]}
                intensity={0.95}
                distance={7}
                decay={2}
                color="#8fc9ff"
              />
            </group>
          ))}

          <Courtroom />

          {showJudgeEntrance ? (
            <JudgeEntranceSequence
              startPosition={JUDGE_ENTRANCE_START_POSITION}
              approachPosition={JUDGE_ENTRANCE_APPROACH_POSITION}
              chairPosition={JUDGE_CHAIR_POSITION}
              rotationY={JUDGE_AVATAR_CONFIG.rotationY + JUDGE_RUNTIME.rotationOffsetY}
              scale={JUDGE_SCALE}
              walkUrl={judgeEntranceWalkUrl}
              sitTransitionUrl={judgeEntranceSitTransitionUrl}
              seatedIdleUrl={judgeEntranceSeatedIdleUrl}
            />
          ) : (
            <AvatarModel
              url={judgeAvatarUrl}
              position={JUDGE_CHAIR_POSITION}
              rotation={[0, JUDGE_AVATAR_CONFIG.rotationY + JUDGE_RUNTIME.rotationOffsetY, 0]}
              scale={JUDGE_SCALE}
              lipsyncManager={lipsyncManager}
              isSpeaking={roleForAnimation === 'judge'}
              sitting={judgeSitting}
              stationary={judgeStationary}
              poseConfig={JUDGE_POSE_CONFIG}
              animationLibrary={judgeUsesClip ? judgeAvatarLibrary : undefined}
              activeAnimationAssetId={judgeAnimationConfig.assetId}
              playEmbeddedAnimation={judgeUsesClip}
              animationLoop={judgeAnimationLoop}
              animationSpeed={judgeAnimationSpeed}
              animationBlendDuration={animationBlendDuration}
              clipPulseEnabled={judgeAnimationState === 'seatedIdle'}
              clipPulseMovementSpeedScale={0.4}
              clipPulseMoveDurationRange={[1.0, 1.9]}
              clipPulseRestDurationRange={[1.2, 2.8]}
              idleMotionEnabled={judgeAnimationState === 'seatedIdle'}
              idleMotionAmplitude={0.022}
              idleMotionArmAmplitude={0.034}
              idleMotionSpeed={1.2}
              onAnimationActionFinished={
                !judgeUsesClip || judgeAnimationLoop
                  ? undefined
                  : () => onAnimationStateFinished?.('judge', judgeAnimationState)
              }
            />
          )}

          <AvatarModel
            url={COUNSEL_AVATAR_URL}
            position={[
              COURTROOM_CONFIG.counselTables.plaintiffX + COUNSEL_AVATAR_CONFIG.offsetX + COUNSEL_RUNTIME.positionOffset[0],
              COUNSEL_SEAT_Y + COUNSEL_AVATAR_CONFIG.offsetY + COUNSEL_RUNTIME.positionOffset[1],
              COURTROOM_CONFIG.counselTables.tableZ +
                COURTROOM_CONFIG.counselTables.chairZOffset +
                COUNSEL_AVATAR_CONFIG.offsetZ +
                COUNSEL_RUNTIME.positionOffset[2],
            ]}
            rotation={[0, COUNSEL_AVATAR_CONFIG.rotationY + COUNSEL_RUNTIME.rotationOffsetY, 0]}
            scale={COUNSEL_SCALE}
            lipsyncManager={lipsyncManager}
            isSpeaking={roleForAnimation === 'counsel'}
            sitting={counselSitting}
            stationary={counselStationary}
            poseConfig={COUNSEL_POSE_CONFIG}
            animationLibrary={counselUsesClip ? AVATAR_GLB_ASSETS.counsel : undefined}
            activeAnimationAssetId={counselAnimationConfig.assetId}
            playEmbeddedAnimation={counselUsesClip}
            animationLoop={counselAnimationLoop}
            animationSpeed={counselAnimationSpeed}
            animationBlendDuration={animationBlendDuration}
            clipPulseEnabled={counselAnimationState === 'seatedIdle'}
            clipPulseMovementSpeedScale={0.32}
            clipPulseMoveDurationRange={[0.9, 1.7]}
            clipPulseRestDurationRange={[1.5, 3.1]}
            idleMotionEnabled={counselAnimationState === 'seatedIdle'}
            idleMotionAmplitude={0.019}
            idleMotionArmAmplitude={0.028}
            idleMotionSpeed={1.05}
            onAnimationActionFinished={
              !counselUsesClip || counselAnimationLoop
                ? undefined
                : () => onAnimationStateFinished?.('counsel', counselAnimationState)
            }
          />

          <Environment preset="sunset" environmentIntensity={0.3} />
        </group>
      </Suspense>

      <OrbitControls
        ref={orbitControlsRef}
        enableZoom={false}
        enablePan={false}
        enableDamping
        dampingFactor={0.06}
        rotateSpeed={SCENE_CONFIG.camera.rotateSpeed}
      />

      <CinematicCameraRig controlsRef={orbitControlsRef} />
      <KeyboardCameraControls controlsRef={orbitControlsRef} />
    </Canvas>
  )
}

const JUDGE_AVATAR_ASSET_URLS = Array.from(
  new Set(Object.values(JUDGE_AVATAR_ASSETS_BY_DIFFICULTY).flatMap((assets) => Object.values(assets)))
)
JUDGE_AVATAR_ASSET_URLS.forEach((assetUrl) => useGLTF.preload(assetUrl))
Object.values(AVATAR_GLB_ASSETS.counsel).forEach((assetUrl) => useGLTF.preload(assetUrl))
