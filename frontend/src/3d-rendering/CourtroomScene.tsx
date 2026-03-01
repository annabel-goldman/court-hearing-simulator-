/**
 * CourtroomScene Component
 *
 * Main 3D canvas wrapper containing the courtroom environment,
 * avatars, lighting, and camera controls.
 */

import { Suspense, useEffect, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Environment, Sparkles, useGLTF } from '@react-three/drei'
import { Lipsync } from 'wawa-lipsync'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { SCENE_PRESETS, type SceneConfig } from './scenePresets'
import { Courtroom } from './Courtroom'
import { AvatarModel } from './AvatarModel'
import type { SpeakingRole, SimulationPhase } from './types'

const SCENE_CONFIG: SceneConfig = SCENE_PRESETS.default
const LAYOUT = SCENE_CONFIG.layout
const COURTROOM_CONFIG = {
  scale: SCENE_CONFIG.sceneScale,
  judgeBench: SCENE_CONFIG.judgeBench,
  counselTables: SCENE_CONFIG.counselTables,
}
const AVATAR_SCALE = SCENE_CONFIG.avatars.scale
const JUDGE_AVATAR_CONFIG = SCENE_CONFIG.avatars.judge
const COUNSEL_AVATAR_CONFIG = SCENE_CONFIG.avatars.counsel

const JUDGE_AVATAR_ID = '697ab5e01ec79b3aa50474e8'
const COUNSEL_AVATAR_ID = '697ab71e9abea698d4b94eca'
const AVATAR_PARAMS = '?morphTargets=ARKit,Oculus+Visemes,mouthOpen,mouthSmile,eyesClosed,eyesLookUp,eyesLookDown&textureSizeLimit=1024&textureFormat=png'
const JUDGE_AVATAR_URL = `https://models.readyplayer.me/${JUDGE_AVATAR_ID}.glb${AVATAR_PARAMS}`
const COUNSEL_AVATAR_URL = `https://models.readyplayer.me/${COUNSEL_AVATAR_ID}.glb${AVATAR_PARAMS}`

interface CameraShot {
  position: [number, number, number]
  target: [number, number, number]
  minPolar: number
  maxPolar: number
  minAzimuth: number
  maxAzimuth: number
  autoRotate: boolean
  autoRotateSpeed: number
}

const CAMERA_SHOTS: Record<SimulationPhase, CameraShot> = {
  OFF_RECORD: {
    position: [0, 2.25, 6.8],
    target: [0, 1.2, -2.2],
    minPolar: Math.PI / 3.2,
    maxPolar: Math.PI / 2.1,
    minAzimuth: -0.75,
    maxAzimuth: 0.75,
    autoRotate: false,
    autoRotateSpeed: 0,
  },
  ALL_RISE: {
    // Keep the same initial viewpoint during "All Rise" so the user doesn't move.
    position: [0, 2.25, 6.8],
    target: [0, 1.2, -2.2],
    minPolar: Math.PI / 3.2,
    maxPolar: Math.PI / 2.1,
    minAzimuth: -0.75,
    maxAzimuth: 0.75,
    autoRotate: false,
    autoRotateSpeed: 0,
  },
  JUDGE_ENTERING: {
    position: [0.9, 2.0, 4.9],
    target: [0, 1.35, -3.2],
    minPolar: Math.PI / 3.3,
    maxPolar: Math.PI / 2.0,
    minAzimuth: -0.65,
    maxAzimuth: 0.3,
    autoRotate: true,
    autoRotateSpeed: 0.12,
  },
  JUDGE_SEATED: {
    position: [-0.35, 1.8, 3.1],
    target: [0, 1.35, -3.45],
    minPolar: Math.PI / 3.4,
    maxPolar: Math.PI / 1.9,
    minAzimuth: -0.5,
    maxAzimuth: 0.4,
    autoRotate: false,
    autoRotateSpeed: 0,
  },
  PROCEEDING: {
    position: [-1.35, 1.55, 1.8],
    target: [-1.28, 1.53, 1.55],
    minPolar: Math.PI / 3.6,
    maxPolar: Math.PI / 1.8,
    minAzimuth: -1.1,
    maxAzimuth: 0.85,
    autoRotate: false,
    autoRotateSpeed: 0,
  },
  ADJOURNED: {
    position: [0, 2.2, 6.5],
    target: [0, 1.3, -2.4],
    minPolar: Math.PI / 3.2,
    maxPolar: Math.PI / 1.9,
    minAzimuth: -0.8,
    maxAzimuth: 0.8,
    autoRotate: true,
    autoRotateSpeed: 0.2,
  },
}

const FIXED_CAMERA_SHOT: CameraShot = CAMERA_SHOTS.PROCEEDING

export interface CourtroomSceneProps {
  speakingRole: SpeakingRole
  lipsyncManager: Lipsync | null
  orbitControlsRef: React.MutableRefObject<OrbitControlsImpl | null>
}

function LoadingAvatar() {
  return (
    <mesh>
      <sphereGeometry args={[0.3, 32, 32]} />
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

    const shot = FIXED_CAMERA_SHOT

    controls.minPolarAngle = shot.minPolar
    controls.maxPolarAngle = shot.maxPolar
    controls.minAzimuthAngle = shot.minAzimuth
    controls.maxAzimuthAngle = shot.maxAzimuth
    controls.autoRotate = shot.autoRotate
    controls.autoRotateSpeed = shot.autoRotateSpeed

    if (!initializedRef.current) {
      camera.position.set(...shot.position)
      controls.target.set(...shot.target)
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

export function CourtroomScene({ speakingRole, lipsyncManager, orbitControlsRef }: CourtroomSceneProps) {
  return (
    <Canvas
      camera={{
        position: FIXED_CAMERA_SHOT.position,
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

      <ambientLight intensity={0.35} color="#fff5e5" />
      <hemisphereLight intensity={0.45} color="#f7ecdb" groundColor="#251d14" />

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
          <Courtroom />

          <AvatarModel
            url={JUDGE_AVATAR_URL}
            position={[
              JUDGE_AVATAR_CONFIG.offsetX,
              0.6 + COURTROOM_CONFIG.judgeBench.chair.seatHeight - JUDGE_AVATAR_CONFIG.pose.hipOffsetY + JUDGE_AVATAR_CONFIG.offsetY,
              LAYOUT.judgeBench + COURTROOM_CONFIG.judgeBench.chair.zOffset + JUDGE_AVATAR_CONFIG.offsetZ,
            ]}
            rotation={[0, JUDGE_AVATAR_CONFIG.rotationY, 0]}
            scale={AVATAR_SCALE}
            lipsyncManager={lipsyncManager}
            isSpeaking={speakingRole === 'judge'}
            sitting={true}
            poseConfig={JUDGE_AVATAR_CONFIG.pose}
          />

          <AvatarModel
            url={COUNSEL_AVATAR_URL}
            position={[
              COURTROOM_CONFIG.counselTables.plaintiffX + COUNSEL_AVATAR_CONFIG.offsetX,
              COURTROOM_CONFIG.counselTables.chairSeatHeight - COUNSEL_AVATAR_CONFIG.pose.hipOffsetY + COUNSEL_AVATAR_CONFIG.offsetY,
              COURTROOM_CONFIG.counselTables.tableZ + COURTROOM_CONFIG.counselTables.chairZOffset + COUNSEL_AVATAR_CONFIG.offsetZ,
            ]}
            rotation={[0, COUNSEL_AVATAR_CONFIG.rotationY, 0]}
            scale={AVATAR_SCALE}
            lipsyncManager={lipsyncManager}
            isSpeaking={speakingRole === 'counsel'}
            sitting={true}
            poseConfig={COUNSEL_AVATAR_CONFIG.pose}
          />

          <Sparkles count={45} scale={[16, 4.5, 14]} size={0.9} speed={0.15} color="#d4bc91" />
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

useGLTF.preload(JUDGE_AVATAR_URL)
useGLTF.preload(COUNSEL_AVATAR_URL)
