/**
 * CourtroomScene Component
 * 
 * Main 3D canvas wrapper containing the courtroom environment,
 * avatars, lighting, and camera controls.
 */

import { Suspense, useEffect } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, Environment, useGLTF } from '@react-three/drei'
import { Lipsync } from 'wawa-lipsync'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { SCENE_PRESETS, type SceneConfig } from './scenePresets'
import { Courtroom } from './Courtroom'
import { AvatarModel } from './AvatarModel'
import type { SpeakingRole } from './types'

// Scene configuration
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

// Avatar URLs
const JUDGE_AVATAR_ID = '697ab5e01ec79b3aa50474e8'
const COUNSEL_AVATAR_ID = '697ab71e9abea698d4b94eca'
const AVATAR_PARAMS = '?morphTargets=ARKit,Oculus+Visemes,mouthOpen,mouthSmile,eyesClosed,eyesLookUp,eyesLookDown&textureSizeLimit=1024&textureFormat=png'
const JUDGE_AVATAR_URL = `https://models.readyplayer.me/${JUDGE_AVATAR_ID}.glb${AVATAR_PARAMS}`
const COUNSEL_AVATAR_URL = `https://models.readyplayer.me/${COUNSEL_AVATAR_ID}.glb${AVATAR_PARAMS}`

// Camera target
const CAMERA_TARGET: [number, number, number] = [
  SCENE_CONFIG.camera.position[0],
  SCENE_CONFIG.camera.position[1],
  SCENE_CONFIG.camera.position[2] - 0.01
]

export interface CourtroomSceneProps {
  speakingRole: SpeakingRole
  lipsyncManager: Lipsync | null
  orbitControlsRef: React.MutableRefObject<OrbitControlsImpl | null>
}

function LoadingAvatar() {
  return (
    <mesh>
      <sphereGeometry args={[0.3, 32, 32]} />
      <meshStandardMaterial color="#3b82f6" wireframe />
    </mesh>
  )
}

function KeyboardCameraControls({ controlsRef }: { controlsRef: React.RefObject<OrbitControlsImpl> }) {
  const { camera } = useThree()
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!controlsRef.current) return
      
      const rotateAmount = 0.1
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
  }, [controlsRef, camera])
  
  return null
}

export function CourtroomScene({ speakingRole, lipsyncManager, orbitControlsRef }: CourtroomSceneProps) {
  return (
    <Canvas
      camera={{ 
        position: SCENE_CONFIG.camera.position as [number, number, number],
        fov: SCENE_CONFIG.camera.fov
      }}
      shadows="soft"
      dpr={[1, 1.5]}
      style={{ background: 'linear-gradient(180deg, #1a1a2e 0%, #0d0d15 100%)' }}
      gl={{ 
        antialias: true,
        powerPreference: 'high-performance',
        stencil: false,
      }}
    >
      <fog attach="fog" args={['#1a1a2e', 6, 14]} />
      
      <ambientLight intensity={0.5} color="#fff5e6" />
      
      <directionalLight 
        position={[0, 5, 0]} 
        intensity={0.7} 
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-far={12}
        shadow-camera-left={-5}
        shadow-camera-right={5}
        shadow-camera-top={5}
        shadow-camera-bottom={-5}
        shadow-bias={-0.001}
        color="#fff8f0"
      />
      
      <directionalLight position={[-3, 4, 1]} intensity={0.3} color="#e6f0ff" />
      <directionalLight position={[3, 4, 1]} intensity={0.3} color="#fff0e6" />
      
      <spotLight position={[0, 4, -2]} angle={0.6} penumbra={0.5} intensity={1.2} color="#fff5e0" />
      <spotLight position={[1.5, 3, 0]} angle={0.7} penumbra={0.5} intensity={0.8} color="#fff8f0" />
      
      <Suspense fallback={<LoadingAvatar />}>
        <group scale={[COURTROOM_CONFIG.scale, COURTROOM_CONFIG.scale, COURTROOM_CONFIG.scale]}>
          <Courtroom />
          
          <AvatarModel 
            url={JUDGE_AVATAR_URL}
            position={[
              JUDGE_AVATAR_CONFIG.offsetX, 
              0.6 + COURTROOM_CONFIG.judgeBench.chair.seatHeight - JUDGE_AVATAR_CONFIG.pose.hipOffsetY + JUDGE_AVATAR_CONFIG.offsetY, 
              LAYOUT.judgeBench + COURTROOM_CONFIG.judgeBench.chair.zOffset + JUDGE_AVATAR_CONFIG.offsetZ
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
          
          <Environment preset="city" />
        </group>
      </Suspense>
      
      <OrbitControls 
        ref={orbitControlsRef}
        enableZoom={false}
        enablePan={false}
        minPolarAngle={SCENE_CONFIG.camera.minPolarAngle}
        maxPolarAngle={SCENE_CONFIG.camera.maxPolarAngle}
        minAzimuthAngle={SCENE_CONFIG.camera.minAzimuthAngle}
        maxAzimuthAngle={SCENE_CONFIG.camera.maxAzimuthAngle}
        rotateSpeed={SCENE_CONFIG.camera.rotateSpeed}
        target={CAMERA_TARGET}
      />
      
      <KeyboardCameraControls controlsRef={orbitControlsRef} />
    </Canvas>
  )
}

// Preload avatars
useGLTF.preload(JUDGE_AVATAR_URL)
useGLTF.preload(COUNSEL_AVATAR_URL)
