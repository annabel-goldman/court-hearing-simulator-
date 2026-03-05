import { Suspense, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { AvatarModel } from '../3d-rendering/AvatarModel'
import { getAssetUrl } from '../config/assetUrls'
import type { LandingIntroAnimationAssetId } from '../config/homeLandingConfig'

type FacingDirection = 'left' | 'right'
type LandingAvatarRole = 'judge' | 'counsel'

export interface LandingAgreementAvatarProps {
  role: LandingAvatarRole
  facing: FacingDirection
  animationAssetId?: LandingIntroAnimationAssetId
  scale?: number
  xOffset?: number
  yOffset?: number
  zOffset?: number
  animationSpeed?: number
}

const LANDING_AVATAR_ASSET_LIBRARY = {
  judge: {
    seatedAnswering: getAssetUrl('3d-rendering/glb/Medium Judge/Meshy_AI_Animation_Sitting_Answering_Questions_withSkin.glb'),
    agreeGesture: getAssetUrl('3d-rendering/glb/Medium Judge/Meshy_AI_Animation_Agree_Gesture_withSkin.glb'),
    standAndChat: getAssetUrl('3d-rendering/glb/Medium Judge/Meshy_AI_Animation_Talk_with_Hands_Open_withSkin.glb'),
  },
  counsel: {
    seatedAnswering: getAssetUrl('3d-rendering/glb/Opposing Council/Meshy_AI_Animation_Sitting_Answering_Questions_withSkin.glb'),
    agreeGesture: getAssetUrl('3d-rendering/glb/Opposing Council/Meshy_AI_Animation_Agree_Gesture_withSkin.glb'),
    standAndChat: getAssetUrl('3d-rendering/glb/Opposing Council/Meshy_AI_Animation_Stand_and_Chat_withSkin.glb'),
  },
} as const

export function LandingAgreementAvatar({
  role,
  facing,
  animationAssetId = 'agreeGesture',
  scale = 1.02,
  xOffset = 0,
  yOffset = -1.22,
  zOffset = 0,
  animationSpeed = 0.9,
}: LandingAgreementAvatarProps) {
  const library = useMemo(() => LANDING_AVATAR_ASSET_LIBRARY[role], [role])
  const selectedAnimationAssetId = library[animationAssetId] ? animationAssetId : 'seatedAnswering'
  const baseUrl = library.seatedAnswering ?? library[selectedAnimationAssetId]
  const rotationY = facing === 'left' ? -20 : 20

  return (
    <Canvas
      camera={{ position: [0, 0.72, 4.6], fov: 34 }}
      dpr={[1, 1.5]}
      style={{ background: 'transparent' }}
      gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
    >
      <ambientLight intensity={0.9} color="#f4e4cc" />
      <directionalLight position={[1.8, 3.4, 2.5]} intensity={1.12} color="#fff0d8" />
      <directionalLight position={[-2.1, 2.3, 1.4]} intensity={0.28} color="#9ac7ff" />

      <Suspense fallback={null}>
        <AvatarModel
          url={baseUrl}
          position={[xOffset, yOffset, zOffset]}
          rotation={[0, rotationY, 0]}
          scale={scale}
          lipsyncManager={null}
          isSpeaking={false}
          sitting={false}
          stationary
          animationLibrary={library}
          activeAnimationAssetId={selectedAnimationAssetId}
          playEmbeddedAnimation
          animationLoop
          animationSpeed={animationSpeed}
        />
      </Suspense>
    </Canvas>
  )
}
