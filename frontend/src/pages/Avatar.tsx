import { useState, useRef, useEffect, Suspense, useMemo, memo } from 'react'
import { Link } from 'react-router-dom'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, useGLTF, Environment, Text } from '@react-three/drei'
import { Lipsync } from 'wawa-lipsync'
import * as THREE from 'three'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { SCENE_PRESETS, type SceneConfig, type AvatarPoseConfig } from '../config/scenePresets'

// Viseme mapping for Ready Player Me avatars
const VISEME_MAP: Record<string, string> = {
  'aa': 'viseme_aa',
  'E': 'viseme_E', 
  'I': 'viseme_I',
  'O': 'viseme_O',
  'U': 'viseme_U',
  'CH': 'viseme_CH',
  'DD': 'viseme_DD',
  'FF': 'viseme_FF',
  'kk': 'viseme_kk',
  'nn': 'viseme_nn',
  'PP': 'viseme_PP',
  'RR': 'viseme_RR',
  'sil': 'viseme_sil',
  'SS': 'viseme_SS',
  'TH': 'viseme_TH',
}

// ============================================================================
// CUSTOM AVATAR URLS - Replace these with your Ready Player Me avatar IDs
// ============================================================================
// 
// HOW TO CREATE YOUR CUSTOM AVATARS:
// 
// 1. Go to: https://readyplayer.me/avatar
// 2. Click "Create Avatar" 
// 3. Choose body type and customize face/features
// 4. IMPORTANT: Click "Outfits" tab and select formal attire:
//    - For JUDGE: Pick a dark suit or formal business wear
//    - For COUNSEL: Pick professional business attire
// 5. Click "Next" then "Done"
// 6. You'll get a URL like: https://models.readyplayer.me/YOUR_AVATAR_ID.glb
// 7. Copy just the ID (the part before .glb) and paste it below
//
// Example: If your URL is https://models.readyplayer.me/abc123def456.glb
// Then your AVATAR_ID is: abc123def456
// ============================================================================

// Replace these IDs with your custom avatar IDs from Ready Player Me
const JUDGE_AVATAR_ID = '697ab5e01ec79b3aa50474e8'  // Custom Judge avatar
const COUNSEL_AVATAR_ID = '697ab71e9abea698d4b94eca'  // Custom Counsel avatar

// Build the full URLs with required parameters for lip-sync
const AVATAR_PARAMS = '?morphTargets=ARKit,Oculus+Visemes,mouthOpen,mouthSmile,eyesClosed,eyesLookUp,eyesLookDown&textureSizeLimit=1024&textureFormat=png'
const JUDGE_AVATAR_URL = `https://models.readyplayer.me/${JUDGE_AVATAR_ID}.glb${AVATAR_PARAMS}`
const COUNSEL_AVATAR_URL = `https://models.readyplayer.me/${COUNSEL_AVATAR_ID}.glb${AVATAR_PARAMS}`

// ============================================================================
// SCENE CONFIGURATION - SELECT PRESET
// ============================================================================
// 
// Scene configurations are stored in: src/config/scenePresets.ts
// 
// Available presets:
//   - SCENE_PRESETS.default     : Standard courtroom view
//   - SCENE_PRESETS.closeUp     : Zoomed in for dramatic moments
//   - SCENE_PRESETS.wideShot    : Wider view showing more courtroom
//   - SCENE_PRESETS.centerAisle : Standing in the center aisle
//
// To add new presets, edit src/config/scenePresets.ts
//
// ============================================================================

// CHANGE THIS LINE TO SWITCH PRESETS:
const SCENE_CONFIG: SceneConfig = SCENE_PRESETS.default

// ============================================================================
// DERIVED CONSTANTS (computed from SCENE_CONFIG - no need to edit)
// ============================================================================

// Shorthand references to config sections for code readability
const ROOM = SCENE_CONFIG.room
const LAYOUT = SCENE_CONFIG.layout
const COLORS = SCENE_CONFIG.colors
const COURTROOM_CONFIG = {
  scale: SCENE_CONFIG.sceneScale,
  judgeBench: SCENE_CONFIG.judgeBench,
  counselTables: SCENE_CONFIG.counselTables,
}

// Avatar scale and positioning
const AVATAR_SCALE = SCENE_CONFIG.avatars.scale
const JUDGE_AVATAR_CONFIG = SCENE_CONFIG.avatars.judge
const COUNSEL_AVATAR_CONFIG = SCENE_CONFIG.avatars.counsel

// Camera target - auto-calculated from position for first-person look-around
// Places target slightly in front of camera (toward judge) so you rotate in place
const CAMERA_TARGET: [number, number, number] = [
  SCENE_CONFIG.camera.position[0],      // Same X as position
  SCENE_CONFIG.camera.position[1],      // Same Y as position  
  SCENE_CONFIG.camera.position[2] - 0.01 // Slightly toward judge (-Z direction)
]

type SpeakingRole = 'judge' | 'counsel' | null

interface AvatarModelProps {
  url: string
  position: [number, number, number]
  rotation?: [number, number, number]
  scale?: number
  lipsyncManager: Lipsync | null
  isSpeaking: boolean
  label?: string
  sitting?: boolean
  poseConfig?: AvatarPoseConfig  // Custom pose configuration
}

function AvatarModel({ 
  url, 
  position, 
  rotation = [0, 0, 0], 
  scale = 1, 
  lipsyncManager, 
  isSpeaking,
  sitting = false,
  poseConfig,
}: AvatarModelProps) {
  const { scene } = useGLTF(url)
  const groupRef = useRef<THREE.Group>(null)
  const [morphTargetMeshes, setMorphTargetMeshes] = useState<THREE.SkinnedMesh[]>([])
  
  // Default pose values (can be overridden by poseConfig)
  const pose = poseConfig || {
    hipTiltX: 0.15,
    hipOffsetY: 1.30,
    thighRotationX: Math.PI / 2,
    calfRotationX: Math.PI / 2,
    footRotationX: 0,
    spineLeanX: -0.05,
  }
  
  // Clone the scene using SkeletonUtils for proper skinned mesh cloning
  const clonedScene = useMemo(() => {
    // SkeletonUtils can be default export or have clone as property depending on bundler
    const cloneFn = (SkeletonUtils as any).clone || (SkeletonUtils as any).default?.clone || SkeletonUtils
    return cloneFn(scene) as THREE.Group
  }, [scene])

  // Find all meshes with morph targets in the cloned scene and apply sitting pose
  useEffect(() => {
    const meshes: THREE.SkinnedMesh[] = []
    clonedScene.traverse((child) => {
      if (child instanceof THREE.SkinnedMesh && child.morphTargetDictionary && child.morphTargetInfluences) {
        meshes.push(child)
        // CRITICAL: Disable frustum culling to prevent head from disappearing during morph animations
        // When morph targets are animated, the bounding box doesn't update, causing incorrect culling
        child.frustumCulled = false
      }
      
      // Apply sitting pose by rotating skeleton bones using pose config
      if (sitting && child instanceof THREE.Bone) {
        const boneName = child.name.toLowerCase()
        
        // Tilt hips back based on pose config
        if (boneName.includes('hips') || boneName.includes('pelvis')) {
          child.rotation.x = pose.hipTiltX
        }
        // Upper legs (thighs): rotate based on pose config
        if (boneName.includes('upleg') || boneName.includes('thigh') || boneName.includes('upperleg')) {
          child.rotation.z = 0
          child.rotation.x = pose.thighRotationX
        }
        // Lower legs (calves): rotate based on pose config
        if (boneName.includes('leg') && (boneName.includes('left') || boneName.includes('right')) && 
            !boneName.includes('up') && !boneName.includes('upper') && !boneName.includes('thigh')) {
          child.rotation.z = 0
          child.rotation.x = pose.calfRotationX
        }
        // Feet: rotate based on pose config
        if (boneName.includes('foot')) {
          child.rotation.z = 0
          child.rotation.x = pose.footRotationX
        }
        // Spine: lean based on pose config
        if (boneName.includes('spine')) {
          child.rotation.x = pose.spineLeanX
        }
      }
    })
    setMorphTargetMeshes(meshes)
  }, [clonedScene, sitting, pose])

  // Animate lip sync
  useFrame(() => {
    if (!lipsyncManager || !isSpeaking || morphTargetMeshes.length === 0) {
      // Reset all visemes when not speaking
      morphTargetMeshes.forEach(mesh => {
        if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
          Object.values(VISEME_MAP).forEach(visemeName => {
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
      return
    }

    // Process audio and get current viseme
    lipsyncManager.processAudio()
    const currentViseme = lipsyncManager.viseme
    const visemeName = VISEME_MAP[currentViseme] || 'viseme_sil'
    // The Lipsync type does not expose `volume` in its typings, but it exists at runtime.
    const rawIntensity = (lipsyncManager as any).volume as number
    // Clamp intensity to safe range (0.0 - 0.8) to prevent extreme morph deformations
    const intensity = Math.min(rawIntensity * 1.5, 0.8)

    // Apply viseme to all morphable meshes
    morphTargetMeshes.forEach(mesh => {
      if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
        Object.values(VISEME_MAP).forEach(name => {
          const index = mesh.morphTargetDictionary![name]
          if (index !== undefined) {
            const targetValue = name === visemeName ? intensity : 0
            mesh.morphTargetInfluences![index] = THREE.MathUtils.lerp(
              mesh.morphTargetInfluences![index],
              targetValue,
              0.25  // Slightly slower lerp for smoother animation
            )
          }
        })
      }
    })
  })

  // Subtle idle animation (breathing)
  useFrame((state) => {
    if (groupRef.current) {
      const baseY = position[1]
      groupRef.current.position.y = baseY + Math.sin(state.clock.elapsedTime * 0.5) * 0.005
    }
  })

  return (
    <group 
      ref={groupRef} 
      position={position} 
      rotation={rotation.map(r => r * Math.PI / 180) as [number, number, number]}
      scale={scale}
    >
      <primitive object={clonedScene} />
    </group>
  )
}

// ============================================================================
// COURTROOM COMPONENTS
// ============================================================================
// 
// The 3D courtroom is built from modular components defined below.
// All configuration values come from SCENE_CONFIG at the top of the file.
//
// ============================================================================

// --- FLOOR ---
// Marble floor with decorative patterns and center aisle carpet
// Memoized to prevent re-renders (static geometry)
const Floor = memo(function Floor() {
  const floorY = 0
  const floorCenter = (ROOM.frontWall + ROOM.backWall) / 2  // Z center of room
  const floorLength = ROOM.backWall - ROOM.frontWall
  
  return (
    <group>
      {/* Base marble floor - covers entire room */}
      <mesh 
        rotation={[-Math.PI / 2, 0, 0]} 
        position={[0, floorY, floorCenter]} 
        receiveShadow
      >
        <planeGeometry args={[ROOM.width, floorLength]} />
        <meshStandardMaterial color={COLORS.marbleCream} roughness={0.3} metalness={0.1} />
      </mesh>
      
      {/* Decorative border - runs along left and right edges */}
      {[ROOM.leftWall + 0.5, ROOM.rightWall - 0.5].map((x, i) => (
        <mesh 
          key={`floor-border-x-${i}`} 
          rotation={[-Math.PI / 2, 0, 0]} 
          position={[x, floorY + 0.001, floorCenter]} 
          receiveShadow
        >
          <planeGeometry args={[0.5, floorLength]} />
          <meshStandardMaterial color={COLORS.marbleGray} roughness={0.4} />
        </mesh>
      ))}
      
      {/* Decorative border - runs along front and back edges */}
      {[ROOM.frontWall + 0.5, ROOM.backWall - 0.5].map((z, i) => (
        <mesh 
          key={`floor-border-z-${i}`} 
          rotation={[-Math.PI / 2, 0, 0]} 
          position={[0, floorY + 0.001, z]} 
          receiveShadow
        >
          <planeGeometry args={[ROOM.width, 0.5]} />
          <meshStandardMaterial color={COLORS.marbleGray} roughness={0.4} />
        </mesh>
      ))}
      
      {/* Center aisle carpet - runs from bar to back entrance */}
      <mesh 
        rotation={[-Math.PI / 2, 0, 0]} 
        position={[0, floorY + 0.01, (LAYOUT.barDivider + ROOM.backWall) / 2]} 
        receiveShadow
      >
        <planeGeometry args={[3, ROOM.backWall - LAYOUT.barDivider - 1]} />
        <meshStandardMaterial color={COLORS.fabricRed} roughness={0.9} />
      </mesh>
      
      {/* Carpet gold trim on edges */}
      {[-1.45, 1.45].map((x, i) => (
        <mesh 
          key={`carpet-trim-${i}`} 
          rotation={[-Math.PI / 2, 0, 0]} 
          position={[x, floorY + 0.012, (LAYOUT.barDivider + ROOM.backWall) / 2]} 
          receiveShadow
        >
          <planeGeometry args={[0.08, ROOM.backWall - LAYOUT.barDivider - 1]} />
          <meshStandardMaterial color={COLORS.brass} roughness={0.4} metalness={0.5} />
        </mesh>
      ))}
    </group>
  )
})

// --- WOOD PANELING (Wainscoting) ---
// Reusable component for decorative wood panels on lower walls
// height: 3 units, positioned so top is at y=3, bottom at y=0
// Memoized to prevent re-renders (static geometry)
const WoodPaneling = memo(function WoodPaneling({ position, width, height }: { position: [number, number, number], width: number, height: number }) {
  const panelCount = Math.floor(width / 1.5)  // Wider panels for less clutter
  
  return (
    <group position={position}>
      {/* Base panel - main wainscoting surface */}
      <mesh receiveShadow>
        <boxGeometry args={[width, height, 0.1]} />
        <meshStandardMaterial color={COLORS.woodMedium} roughness={0.7} />
      </mesh>
      
      {/* Vertical panel divisions (stiles) - pushed out to prevent Z-fighting */}
      {Array.from({ length: panelCount + 1 }).map((_, i) => (
        <mesh 
          key={`panel-div-${i}`} 
          position={[(-width/2) + (i * (width/panelCount)), 0, 0.08]} 
          castShadow
        >
          <boxGeometry args={[0.05, height * 0.95, 0.04]} />
          <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
        </mesh>
      ))}
      
      {/* Chair rail (top molding at wainscot height) - pushed out to prevent Z-fighting */}
      <mesh position={[0, height/2 + 0.06, 0.12]} castShadow>
        <boxGeometry args={[width, 0.1, 0.08]} />
        <meshStandardMaterial color={COLORS.woodAccent} roughness={0.5} metalness={0.1} />
      </mesh>
      
      {/* Baseboard molding - pushed out to prevent Z-fighting */}
      <mesh position={[0, -height/2 + 0.05, 0.12]} castShadow>
        <boxGeometry args={[width, 0.1, 0.07]} />
        <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
      </mesh>
    </group>
  )
})

// --- WALLS, CEILING & CROWN MOLDING ---
// Memoized to prevent re-renders (static geometry)
const Walls = memo(function Walls() {
  // Wall section heights
  const panelingHeight = ROOM.panelingHeight
  const panelingCenterY = panelingHeight / 2
  const upperWallHeight = ROOM.height - panelingHeight
  const upperWallCenterY = panelingHeight + (upperWallHeight / 2)
  
  // Z center of room for side walls
  const roomCenterZ = (ROOM.frontWall + ROOM.backWall) / 2
  const sideWallLength = ROOM.backWall - ROOM.frontWall
  
  // Crown molding sits just below ceiling, slightly inset from walls to avoid z-fighting
  const crownY = ROOM.height - 0.2
  const crownSize = 0.18
  
  return (
    <group>
      {/* ========== FRONT WALL (behind judge) ========== */}
      {/* Upper painted section */}
      <mesh position={[0, upperWallCenterY, ROOM.frontWall]} receiveShadow>
        <boxGeometry args={[ROOM.width, upperWallHeight, ROOM.wallThickness]} />
        <meshStandardMaterial color={COLORS.wallPaint} roughness={0.9} />
      </mesh>
      {/* Lower wood paneling */}
      <WoodPaneling 
        position={[0, panelingCenterY, ROOM.frontWall + 0.2]} 
        width={ROOM.width} 
        height={panelingHeight} 
      />
      
      {/* ========== BACK WALL (entrance) ========== */}
      {/* Upper painted section */}
      <mesh position={[0, upperWallCenterY, ROOM.backWall]} receiveShadow>
        <boxGeometry args={[ROOM.width, upperWallHeight, ROOM.wallThickness]} />
        <meshStandardMaterial color={COLORS.wallPaint} roughness={0.9} />
      </mesh>
      {/* Lower wood paneling */}
      <WoodPaneling 
        position={[0, panelingCenterY, ROOM.backWall - 0.2]} 
        width={ROOM.width} 
        height={panelingHeight} 
      />
      
      {/* ========== LEFT WALL ========== */}
      <group position={[ROOM.leftWall, 0, roomCenterZ]} rotation={[0, Math.PI / 2, 0]}>
        {/* Upper painted section */}
        <mesh position={[0, upperWallCenterY, 0]} receiveShadow>
          <boxGeometry args={[sideWallLength, upperWallHeight, ROOM.wallThickness]} />
          <meshStandardMaterial color={COLORS.wallPaint} roughness={0.9} />
        </mesh>
        {/* Lower wood paneling */}
        <WoodPaneling 
          position={[0, panelingCenterY, 0.2]} 
          width={sideWallLength} 
          height={panelingHeight} 
        />
      </group>
      
      {/* ========== RIGHT WALL ========== */}
      <group position={[ROOM.rightWall, 0, roomCenterZ]} rotation={[0, Math.PI / 2, 0]}>
        {/* Upper painted section */}
        <mesh position={[0, upperWallCenterY, 0]} receiveShadow>
          <boxGeometry args={[sideWallLength, upperWallHeight, ROOM.wallThickness]} />
          <meshStandardMaterial color={COLORS.wallPaint} roughness={0.9} />
        </mesh>
        {/* Lower wood paneling */}
        <WoodPaneling 
          position={[0, panelingCenterY, -0.2]} 
          width={sideWallLength} 
          height={panelingHeight} 
        />
      </group>
      
      {/* ========== CEILING ========== */}
      <mesh position={[0, ROOM.height, roomCenterZ]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[ROOM.width, sideWallLength]} />
        <meshStandardMaterial color={COLORS.ceiling} roughness={0.9} />
      </mesh>
      
      {/* ========== CROWN MOLDING ========== */}
      {/* Positioned just below ceiling, inset from walls to prevent z-fighting */}
      {/* Front crown */}
      <mesh position={[0, crownY, ROOM.frontWall + crownSize / 2 + 0.1]} castShadow>
        <boxGeometry args={[ROOM.width - 0.6, crownSize, crownSize]} />
        <meshStandardMaterial color={COLORS.woodAccent} roughness={0.5} metalness={0.1} />
      </mesh>
      {/* Back crown */}
      <mesh position={[0, crownY, ROOM.backWall - crownSize / 2 - 0.1]} castShadow>
        <boxGeometry args={[ROOM.width - 0.6, crownSize, crownSize]} />
        <meshStandardMaterial color={COLORS.woodAccent} roughness={0.5} metalness={0.1} />
      </mesh>
      {/* Left crown */}
      <mesh position={[ROOM.leftWall + crownSize / 2 + 0.1, crownY, roomCenterZ]} castShadow>
        <boxGeometry args={[crownSize, crownSize, sideWallLength - 0.6]} />
        <meshStandardMaterial color={COLORS.woodAccent} roughness={0.5} metalness={0.1} />
      </mesh>
      {/* Right crown */}
      <mesh position={[ROOM.rightWall - crownSize / 2 - 0.1, crownY, roomCenterZ]} castShadow>
        <boxGeometry args={[crownSize, crownSize, sideWallLength - 0.6]} />
        <meshStandardMaterial color={COLORS.woodAccent} roughness={0.5} metalness={0.1} />
      </mesh>
      
      {/* ========== WALL SCONCES ========== */}
      {/* Decorative light fixtures on front wall */}
      {[-8, -4, 4, 8].map((x, i) => (
        <group key={`sconce-${i}`} position={[x, 4, ROOM.frontWall + 0.4]}>
          {/* Backplate */}
          <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.12, 0.12, 0.03, 16]} />
            <meshStandardMaterial color={COLORS.brass} roughness={0.3} metalness={0.7} />
          </mesh>
          {/* Arm */}
          <mesh position={[0, 0, 0.12]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.02, 0.02, 0.2, 16]} />
            <meshStandardMaterial color={COLORS.brass} roughness={0.3} metalness={0.7} />
          </mesh>
          {/* Glass shade */}
          <mesh position={[0, 0, 0.25]} castShadow>
            <sphereGeometry args={[0.1, 16, 16]} />
            <meshStandardMaterial color="#fff5e0" roughness={0.2} transparent opacity={0.6} />
          </mesh>
        </group>
      ))}
    </group>
  )
})

// --- JUDGE'S BENCH ---
// Elevated platform with large wooden desk, positioned at front of courtroom
// The judge sits behind this, facing the well and gallery
// Memoized to prevent re-renders (static geometry)
const JudgeBench = memo(function JudgeBench() {
  const benchZ = LAYOUT.judgeBench

  const { tiers, desk, chair } = COURTROOM_CONFIG.judgeBench
  const { tier1, tier2, tier3 } = tiers
  const bench = desk

  const platformTotalHeight = tier1.height + tier2.height + tier3.height
  const benchTop = platformTotalHeight + bench.height

  return (
    <group position={[0, 0, benchZ]}>
      {/* ========== RAISED PLATFORM (3 TIERS) ========== */}
      {/* Tier 1 - largest, at floor level */}
      <mesh position={[0, tier1.height / 2, tier1.depth / 2 - 0.5]} castShadow receiveShadow>
        <boxGeometry args={[tier1.width, tier1.height, tier1.depth]} />
        <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
      </mesh>
      
      {/* Tier 2 - middle step */}
      <mesh position={[0, tier1.height + tier2.height / 2, tier2.depth / 2 - 1]} castShadow receiveShadow>
        <boxGeometry args={[tier2.width, tier2.height, tier2.depth]} />
        <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
      </mesh>
      
      {/* Tier 3 - top platform where judge sits */}
      <mesh position={[0, tier1.height + tier2.height + tier3.height / 2, tier3.depth / 2 - 1.5]} castShadow receiveShadow>
        <boxGeometry args={[tier3.width, tier3.height, tier3.depth]} />
        <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
      </mesh>
      
      {/* ========== BENCH (DESK) - U-SHAPED WITH OPEN BACK FOR JUDGE ========== */}
      {/* 
         The desk is U-shaped: front panel + two side panels, with open back 
         so the judge can sit without clipping through the desk.
         
         All values come from SCENE_CONFIG.judgeBench.desk:
         - width: total desk width
         - depth: total desk depth (front to back)
         - height: desk height
         - frontPanelDepth: thickness of front panel
         - chairOpeningWidth: width of opening for judge's chair/body
         - zOffset: position relative to platform
      */}
      
      {/* U-shaped desk structure using config values */}
      {(() => {
        // All values from config
        const deskY = platformTotalHeight + bench.height / 2
        const deskZ = bench.zOffset || 0
        const frontDepth = bench.frontPanelDepth || 0.3
        const openingWidth = bench.chairOpeningWidth || 1.4
        const sidePanelWidth = (bench.width - openingWidth) / 2
        const sidePanelDepth = bench.depth - frontDepth
        
        return (
          <>
            {/* Front panel - full width */}
            <mesh position={[0, deskY, deskZ + frontDepth / 2]} castShadow receiveShadow>
              <boxGeometry args={[bench.width, bench.height, frontDepth]} />
              <meshStandardMaterial color={COLORS.woodMedium} roughness={0.6} />
            </mesh>
            
            {/* Left side panel */}
            <mesh position={[-(bench.width / 2 - sidePanelWidth / 2), deskY, deskZ - sidePanelDepth / 2]} castShadow receiveShadow>
              <boxGeometry args={[sidePanelWidth, bench.height, sidePanelDepth]} />
              <meshStandardMaterial color={COLORS.woodMedium} roughness={0.6} />
            </mesh>
            
            {/* Right side panel */}
            <mesh position={[(bench.width / 2 - sidePanelWidth / 2), deskY, deskZ - sidePanelDepth / 2]} castShadow receiveShadow>
              <boxGeometry args={[sidePanelWidth, bench.height, sidePanelDepth]} />
              <meshStandardMaterial color={COLORS.woodMedium} roughness={0.6} />
            </mesh>
            
            {/* Desktop surface - full surface on top */}
            <mesh position={[0, platformTotalHeight + bench.height + 0.05, deskZ - bench.depth / 2 + frontDepth / 2]} castShadow receiveShadow>
              <boxGeometry args={[bench.width + 0.2, 0.1, bench.depth + 0.2]} />
              <meshStandardMaterial color={COLORS.woodLight} roughness={0.4} metalness={0.05} />
            </mesh>
            
            {/* Front decorative panel */}
            <mesh position={[0, deskY, deskZ + frontDepth / 2 + 0.06]} castShadow>
              <boxGeometry args={[bench.width - 0.2, bench.height - 0.2, 0.1]} />
              <meshStandardMaterial color={COLORS.woodDark} roughness={0.7} />
            </mesh>
            
            {/* Decorative panel insets */}
            {[-2.2, 0, 2.2].map((x, i) => (
              <mesh key={`bench-inset-${i}`} position={[x, deskY, deskZ + frontDepth / 2 + 0.12]} castShadow>
                <boxGeometry args={[1.8, 0.9, 0.02]} />
                <meshStandardMaterial color={COLORS.woodMedium} roughness={0.5} />
              </mesh>
            ))}
            
            {/* Brass top trim */}
            <mesh position={[0, platformTotalHeight + bench.height - 0.02, deskZ + frontDepth / 2 + 0.06]} castShadow>
              <boxGeometry args={[bench.width, 0.08, 0.12]} />
              <meshStandardMaterial color={COLORS.brass} roughness={0.3} metalness={0.6} />
            </mesh>
          </>
        )
      })()}
      
      {/* ========== GAVEL ========== */}
      <group position={[2.5, benchTop + 0.12, -0.8]}>
        {/* Gavel head */}
        <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.04, 0.04, 0.15, 16]} />
          <meshStandardMaterial color={COLORS.woodDark} roughness={0.5} />
        </mesh>
        {/* Handle */}
        <mesh position={[0, -0.03, 0]} rotation={[Math.PI / 6, 0, 0]} castShadow>
          <cylinderGeometry args={[0.015, 0.02, 0.2, 16]} />
          <meshStandardMaterial color={COLORS.woodMedium} roughness={0.5} />
        </mesh>
        {/* Sound block */}
        <mesh position={[0.2, -0.02, 0]} castShadow>
          <cylinderGeometry args={[0.08, 0.08, 0.03, 16]} />
          <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
        </mesh>
      </group>
      
      {/* Name plate */}
      <mesh position={[0, benchTop + 0.1, -0.2]} castShadow>
        <boxGeometry args={[0.6, 0.1, 0.06]} />
        <meshStandardMaterial color={COLORS.brass} roughness={0.3} metalness={0.7} />
      </mesh>
      
      {/* ========== JUDGE'S CHAIR ========== */}
      {/* High-back leather chair behind the bench */}
      <group position={[0, platformTotalHeight, chair.zOffset]}>
        {/* Chair seat */}
        <mesh position={[0, 0.45, 0]} castShadow>
          <boxGeometry args={[0.7, 0.1, 0.6]} />
          <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
        </mesh>
        
        {/* High back frame */}
        <mesh position={[0, 1.1, -0.25]} castShadow>
          <boxGeometry args={[0.75, 1.2, 0.08]} />
          <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
        </mesh>
        
        {/* Leather back padding */}
        <mesh position={[0, 1.1, -0.2]} castShadow>
          <boxGeometry args={[0.6, 1, 0.06]} />
          <meshStandardMaterial color={COLORS.fabricRed} roughness={0.9} />
        </mesh>
        
        {/* Armrests */}
        {[-0.35, 0.35].map((x, i) => (
          <mesh key={`arm-${i}`} position={[x, 0.6, -0.1]} castShadow>
            <boxGeometry args={[0.08, 0.1, 0.5]} />
            <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
          </mesh>
        ))}

        {/* Simple front chair legs so the seat visually connects to the platform */}
        {[-0.25, 0.25].map((x, i) => (
          <mesh key={`chair-leg-${i}`} position={[x, 0.2, 0.2]} castShadow>
            <boxGeometry args={[0.08, 0.4, 0.08]} />
            <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
          </mesh>
        ))}
      </group>
    </group>
  )
})

// --- FLAGS ---
// American flag on left, State flag on right, flanking the judge
// Memoized to prevent re-renders (static geometry)
const AmericanFlag = memo(function AmericanFlag() {
  const flagZ = ROOM.frontWall + 0.8  // In front of the front wall
  
  return (
    <group position={[-3.5, 0.6, flagZ]}>
      {/* Flag pole */}
      <mesh position={[0, 2, 0]} castShadow>
        <cylinderGeometry args={[0.03, 0.03, 4, 16]} />
        <meshStandardMaterial color={COLORS.brass} roughness={0.3} metalness={0.7} />
      </mesh>
      {/* Pole top ornament (eagle finial) */}
      <mesh position={[0, 4.1, 0]} castShadow>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshStandardMaterial color={COLORS.brass} roughness={0.3} metalness={0.8} />
      </mesh>
      {/* Flag */}
      <mesh position={[0.4, 3.3, 0]} castShadow>
        <boxGeometry args={[0.8, 0.5, 0.02]} />
        <meshStandardMaterial color="#bf0a30" roughness={0.9} />
      </mesh>
      {/* Blue canton */}
      <mesh position={[0.15, 3.45, 0.015]} castShadow>
        <boxGeometry args={[0.3, 0.2, 0.01]} />
        <meshStandardMaterial color="#002868" roughness={0.9} />
      </mesh>
      {/* White stripes */}
      {[3.35, 3.25, 3.15].map((y, i) => (
        <mesh key={`stripe-${i}`} position={[0.4, y, 0.015]} castShadow>
          <boxGeometry args={[0.78, 0.03, 0.01]} />
          <meshStandardMaterial color="#ffffff" roughness={0.9} />
        </mesh>
      ))}
      {/* Flag base */}
      <mesh position={[0, 0.15, 0]} castShadow>
        <cylinderGeometry args={[0.15, 0.2, 0.3, 16]} />
        <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
      </mesh>
    </group>
  )
})

// Memoized to prevent re-renders (static geometry)
const StateFlag = memo(function StateFlag() {
  const flagZ = ROOM.frontWall + 0.8
  
  return (
    <group position={[3.5, 0.6, flagZ]}>
      {/* Flag pole */}
      <mesh position={[0, 2, 0]} castShadow>
        <cylinderGeometry args={[0.03, 0.03, 4, 16]} />
        <meshStandardMaterial color={COLORS.brass} roughness={0.3} metalness={0.7} />
      </mesh>
      {/* Pole top ornament */}
      <mesh position={[0, 4.1, 0]} castShadow>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshStandardMaterial color={COLORS.brass} roughness={0.3} metalness={0.8} />
      </mesh>
      {/* State flag (generic blue) */}
      <mesh position={[-0.4, 3.3, 0]} castShadow>
        <boxGeometry args={[0.8, 0.5, 0.02]} />
        <meshStandardMaterial color={COLORS.fabricBlue} roughness={0.9} />
      </mesh>
      {/* State seal on flag */}
      <mesh position={[-0.4, 3.3, 0.015]} castShadow>
        <circleGeometry args={[0.15, 32]} />
        <meshStandardMaterial color={COLORS.brass} roughness={0.4} metalness={0.3} />
      </mesh>
      {/* Flag base */}
      <mesh position={[0, 0.15, 0]} castShadow>
        <cylinderGeometry args={[0.15, 0.2, 0.3, 16]} />
        <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
      </mesh>
    </group>
  )
})

// --- COURT SEAL ---
// Official seal mounted on front wall above judge
// Memoized to prevent re-renders (static geometry)
const CourtSeal = memo(function CourtSeal() {
  const sealY = 4.5  // Height on wall
  const sealZ = ROOM.frontWall + 0.3  // Slightly in front of wall
  
  return (
    <group position={[0, sealY, sealZ]}>
      {/* Outer ring */}
      <mesh castShadow>
        <torusGeometry args={[1, 0.12, 16, 64]} />
        <meshStandardMaterial color={COLORS.brass} roughness={0.3} metalness={0.7} />
      </mesh>
      {/* Seal background */}
      <mesh position={[0, 0, 0.05]}>
        <circleGeometry args={[0.9, 64]} />
        <meshStandardMaterial color={COLORS.fabricBlue} roughness={0.8} />
      </mesh>
      {/* Inner decorative ring */}
      <mesh position={[0, 0, 0.06]}>
        <torusGeometry args={[0.55, 0.04, 16, 64]} />
        <meshStandardMaterial color={COLORS.brass} roughness={0.3} metalness={0.6} />
      </mesh>
      {/* Center emblem */}
      <mesh position={[0, 0, 0.07]}>
        <circleGeometry args={[0.45, 64]} />
        <meshStandardMaterial color="#1a2d4a" roughness={0.7} />
      </mesh>
      {/* Scales of justice */}
      <group position={[0, 0.05, 0.08]}>
        {/* Balance beam */}
        <mesh>
          <boxGeometry args={[0.45, 0.025, 0.015]} />
          <meshStandardMaterial color={COLORS.brass} roughness={0.3} metalness={0.6} />
        </mesh>
        {/* Center post */}
        <mesh position={[0, -0.12, 0]}>
          <boxGeometry args={[0.025, 0.25, 0.015]} />
          <meshStandardMaterial color={COLORS.brass} roughness={0.3} metalness={0.6} />
        </mesh>
        {/* Left pan */}
        <mesh position={[-0.18, -0.08, 0]}>
          <circleGeometry args={[0.07, 32]} />
          <meshStandardMaterial color={COLORS.brass} roughness={0.3} metalness={0.6} />
        </mesh>
        {/* Right pan */}
        <mesh position={[0.18, -0.08, 0]}>
          <circleGeometry args={[0.07, 32]} />
          <meshStandardMaterial color={COLORS.brass} roughness={0.3} metalness={0.6} />
        </mesh>
      </group>
    </group>
  )
})

// --- WITNESS STAND ---
// Enclosed box where witnesses testify, positioned to left of judge
// Faces the courtroom so jury and counsel can see the witness
// Memoized to prevent re-renders (static geometry)
const WitnessStand = memo(function WitnessStand() {
  // Position: left side of the well, between judge and counsel tables
  const standX = -4
  const standZ = LAYOUT.witnessStand
  const platformSize = { width: 1.5, depth: 1.5, height: 0.3 }
  const enclosureHeight = 0.9
  
  return (
    <group position={[standX, 0, standZ]}>
      {/* Raised platform */}
      <mesh position={[0, platformSize.height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[platformSize.width, platformSize.height, platformSize.depth]} />
        <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
      </mesh>
      
      {/* Front panel (faces jury/gallery) */}
      <mesh position={[0, platformSize.height + enclosureHeight / 2, platformSize.depth / 2 - 0.04]} castShadow>
        <boxGeometry args={[platformSize.width - 0.1, enclosureHeight, 0.08]} />
        <meshStandardMaterial color={COLORS.woodMedium} roughness={0.6} />
      </mesh>
      
      {/* Left side panel */}
      <mesh position={[-platformSize.width / 2 + 0.04, platformSize.height + enclosureHeight / 2, 0]} castShadow>
        <boxGeometry args={[0.08, enclosureHeight, platformSize.depth - 0.2]} />
        <meshStandardMaterial color={COLORS.woodMedium} roughness={0.6} />
      </mesh>
      
      {/* Right side panel (toward judge) */}
      <mesh position={[platformSize.width / 2 - 0.04, platformSize.height + enclosureHeight / 2, 0]} castShadow>
        <boxGeometry args={[0.08, enclosureHeight, platformSize.depth - 0.2]} />
        <meshStandardMaterial color={COLORS.woodMedium} roughness={0.6} />
      </mesh>
      
      {/* Top rail / ledge */}
      <mesh position={[0, platformSize.height + enclosureHeight + 0.03, platformSize.depth / 2 - 0.04]} castShadow>
        <boxGeometry args={[platformSize.width, 0.06, 0.12]} />
        <meshStandardMaterial color={COLORS.woodAccent} roughness={0.5} metalness={0.1} />
      </mesh>
      
      {/* Witness chair */}
      <group position={[0, platformSize.height, -0.15]}>
        {/* Seat */}
        <mesh position={[0, 0.22, 0]} castShadow>
          <boxGeometry args={[0.45, 0.06, 0.4]} />
          <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
        </mesh>
        {/* Back */}
        <mesh position={[0, 0.5, -0.17]} castShadow>
          <boxGeometry args={[0.45, 0.5, 0.05]} />
          <meshStandardMaterial color={COLORS.fabricBlue} roughness={0.9} />
        </mesh>
      </group>
      
      {/* Label */}
      <Text
        position={[0, platformSize.height + enclosureHeight + 0.3, platformSize.depth / 2]}
        fontSize={0.1}
        color="#5c4d3d"
        anchorX="center"
      >
        WITNESS
      </Text>
    </group>
  )
})

// --- JURY BOX ---
// Enclosed seating area for jurors, typically on the right side of courtroom
// Two rows of seats facing the well/witness stand
// Memoized to prevent re-renders (static geometry)
const JuryBox = memo(function JuryBox() {
  // Position: right side of courtroom, angled to view witness and judge
  const boxX = 7
  const boxZ = -1
  const platformSize = { width: 4.5, depth: 3.5, height: 0.25 }
  const railHeight = 1
  const juryRows = 2
  const seatsPerRow = 6
  
  return (
    <group position={[boxX, 0, boxZ]}>
      {/* Raised platform */}
      <mesh position={[0, platformSize.height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[platformSize.width, platformSize.height, platformSize.depth]} />
        <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
      </mesh>
      
      {/* Front railing (faces the well) */}
      <mesh position={[0, platformSize.height + railHeight / 2, platformSize.depth / 2 - 0.04]} castShadow>
        <boxGeometry args={[platformSize.width - 0.2, railHeight - 0.1, 0.08]} />
        <meshStandardMaterial color={COLORS.woodMedium} roughness={0.6} />
      </mesh>
      
      {/* Top rail */}
      <mesh position={[0, platformSize.height + railHeight, platformSize.depth / 2 - 0.04]} castShadow>
        <boxGeometry args={[platformSize.width, 0.08, 0.15]} />
        <meshStandardMaterial color={COLORS.woodAccent} roughness={0.5} />
      </mesh>
      
      {/* Left side panel (toward judge) */}
      <mesh position={[-platformSize.width / 2 + 0.04, platformSize.height + railHeight / 2, 0]} castShadow>
        <boxGeometry args={[0.08, railHeight - 0.1, platformSize.depth - 0.2]} />
        <meshStandardMaterial color={COLORS.woodMedium} roughness={0.6} />
      </mesh>
      
      {/* Jury chairs - 2 rows */}
      {Array.from({ length: juryRows }).map((_, row) => {
        const rowZ = (row - 0.5) * 1.2  // Rows at different Z depths
        const rowY = platformSize.height + (row * 0.15)  // Back row slightly raised
        
        return Array.from({ length: seatsPerRow }).map((_, seat) => {
          const seatX = (seat - (seatsPerRow - 1) / 2) * 0.65  // Spread across width
          
          return (
            <group key={`jury-${row}-${seat}`} position={[seatX, rowY, rowZ]}>
              {/* Seat */}
              <mesh position={[0, 0.22, 0]} castShadow>
                <boxGeometry args={[0.35, 0.05, 0.3]} />
                <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
              </mesh>
              {/* Back */}
              <mesh position={[0, 0.42, -0.12]} castShadow>
                <boxGeometry args={[0.35, 0.35, 0.04]} />
                <meshStandardMaterial color={COLORS.fabricBlue} roughness={0.9} />
              </mesh>
            </group>
          )
        })
      })}
      
      {/* Label */}
      <Text
        position={[0, platformSize.height + railHeight + 0.3, platformSize.depth / 2]}
        fontSize={0.12}
        color="#5c4d3d"
        anchorX="center"
      >
        JURY
      </Text>
    </group>
  )
})

// --- BAR DIVIDER & PUBLIC GALLERY ---
// The "bar" separates the well (lawyers/court) from public seating
// Gallery pews are positioned BEHIND the bar, toward the back entrance
// Memoized to prevent re-renders (static geometry)
const GallerySeating = memo(function GallerySeating() {
  // Bar position - this divides the court area from the public gallery
  const barZ = LAYOUT.barDivider
  const barWidth = 10
  const barHeight = 1
  
  // Gallery bench configuration
  const benchWidth = 8
  const benchRows = 3
  const firstRowZ = LAYOUT.galleryStart + 0.5  // First row of pews
  const rowSpacing = LAYOUT.gallerySpacing
  
  return (
    <group>
      {/* ========== BAR / GATE DIVIDER ========== */}
      {/* This wooden railing separates lawyers from public */}
      
      {/* Bar top rail */}
      <mesh position={[0, barHeight, barZ]} castShadow>
        <boxGeometry args={[barWidth, 0.1, 0.15]} />
        <meshStandardMaterial color={COLORS.woodAccent} roughness={0.5} metalness={0.1} />
      </mesh>
      
      {/* Bar main panel */}
      <mesh position={[0, barHeight / 2, barZ]} castShadow>
        <boxGeometry args={[barWidth, barHeight - 0.1, 0.08]} />
        <meshStandardMaterial color={COLORS.woodMedium} roughness={0.6} />
      </mesh>
      
      {/* Decorative panel inset */}
      <mesh position={[0, barHeight / 2, barZ + 0.05]} castShadow>
        <boxGeometry args={[barWidth - 1, barHeight - 0.3, 0.02]} />
        <meshStandardMaterial color={COLORS.woodLight} roughness={0.5} />
      </mesh>
      
      {/* Brass rail posts */}
      {[-4, -2, 0, 2, 4].map((x, i) => (
        <mesh key={`post-${i}`} position={[x, barHeight / 2, barZ]} castShadow>
          <cylinderGeometry args={[0.03, 0.03, barHeight, 16]} />
          <meshStandardMaterial color={COLORS.brass} roughness={0.3} metalness={0.7} />
        </mesh>
      ))}
      
      {/* Gate (center opening with swinging door) */}
      <mesh position={[0, barHeight / 2 - 0.1, barZ + 0.12]} castShadow>
        <boxGeometry args={[1.2, barHeight - 0.3, 0.04]} />
        <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
      </mesh>
      
      {/* ========== GALLERY BENCHES (PEWS) ========== */}
      {/* Traditional church-style pews for public seating */}
      {Array.from({ length: benchRows }).map((_, row) => {
        const rowZ = firstRowZ + (row * rowSpacing)
        return (
          <group key={`gallery-row-${row}`} position={[0, 0, rowZ]} rotation={[0, Math.PI, 0]}>
            {/* Bench seat */}
            <mesh position={[0, 0.42, 0]} castShadow receiveShadow>
              <boxGeometry args={[benchWidth, 0.08, 0.5]} />
              <meshStandardMaterial color={COLORS.woodMedium} roughness={0.6} />
            </mesh>
            
            {/* Bench back */}
            <mesh position={[0, 0.75, -0.22]} castShadow>
              <boxGeometry args={[benchWidth, 0.55, 0.06]} />
              <meshStandardMaterial color={COLORS.woodMedium} roughness={0.6} />
            </mesh>
            
            {/* Decorative back panel REMOVED - not visible from user POV */}
            
            {/* Bench end supports (legs) */}
            {[-benchWidth/2 + 0.15, 0, benchWidth/2 - 0.15].map((x, i) => (
              <mesh key={`support-${row}-${i}`} position={[x, 0.2, 0]} castShadow>
                <boxGeometry args={[0.1, 0.4, 0.45]} />
                <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
              </mesh>
            ))}
          </group>
        )
      })}
      
      {/* ========== ENTRANCE DOOR ========== */}
      {/* Double doors at back of courtroom */}
      <group position={[0, 0, ROOM.backWall - 0.3]}>
        {/* Door frame */}
        <mesh position={[0, 1.3, 0]} castShadow>
          <boxGeometry args={[2.4, 2.6, 0.08]} />
          <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
        </mesh>
        
        {/* Left door */}
        <mesh position={[-0.55, 1.25, 0.05]} castShadow>
          <boxGeometry args={[1.0, 2.4, 0.06]} />
          <meshStandardMaterial color={COLORS.woodMedium} roughness={0.5} />
        </mesh>
        
        {/* Right door */}
        <mesh position={[0.55, 1.25, 0.05]} castShadow>
          <boxGeometry args={[1.0, 2.4, 0.06]} />
          <meshStandardMaterial color={COLORS.woodMedium} roughness={0.5} />
        </mesh>
        
        {/* Door panels - left door */}
        {[1.7, 0.7].map((y, i) => (
          <mesh key={`lpanel-${i}`} position={[-0.55, y, 0.09]} castShadow>
            <boxGeometry args={[0.7, 0.6, 0.02]} />
            <meshStandardMaterial color={COLORS.woodLight} roughness={0.4} />
          </mesh>
        ))}
        
        {/* Door panels - right door */}
        {[1.7, 0.7].map((y, i) => (
          <mesh key={`rpanel-${i}`} position={[0.55, y, 0.09]} castShadow>
            <boxGeometry args={[0.7, 0.6, 0.02]} />
            <meshStandardMaterial color={COLORS.woodLight} roughness={0.4} />
          </mesh>
        ))}
        
        {/* Door handles */}
        <mesh position={[-0.15, 1.2, 0.12]} castShadow>
          <cylinderGeometry args={[0.025, 0.025, 0.12, 16]} />
          <meshStandardMaterial color={COLORS.brass} roughness={0.3} metalness={0.7} />
        </mesh>
        <mesh position={[0.15, 1.2, 0.12]} castShadow>
          <cylinderGeometry args={[0.025, 0.025, 0.12, 16]} />
          <meshStandardMaterial color={COLORS.brass} roughness={0.3} metalness={0.7} />
        </mesh>
      </group>
    </group>
  )
})

// --- COUNSEL DESK ---
// Counsel desk that faces the judge (toward negative Z)
// Memoized to prevent re-renders (static geometry)
const CounselDesk = memo(function CounselDesk({ position, label, chairOffset = 0.65 }: { position: [number, number, number], label: string, chairOffset?: number }) {
  return (
    <group position={position}>
      {/* Table top */}
      <mesh position={[0, 0.75, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.8, 0.08, 0.8]} />
        <meshStandardMaterial color={COLORS.woodLight} roughness={0.4} metalness={0.05} />
      </mesh>
      {/* Front modesty panel - faces toward judge (negative Z) */}
      <mesh position={[0, 0.4, -0.36]} castShadow receiveShadow>
        <boxGeometry args={[1.7, 0.7, 0.06]} />
        <meshStandardMaterial color={COLORS.woodMedium} roughness={0.6} />
      </mesh>
      {/* Decorative front panel inset */}
      <mesh position={[0, 0.4, -0.39]} castShadow>
        <boxGeometry args={[1.5, 0.55, 0.02]} />
        <meshStandardMaterial color={COLORS.woodLight} roughness={0.5} />
      </mesh>
      {/* Table legs */}
      {[[-0.8, -0.3], [-0.8, 0.3], [0.8, -0.3], [0.8, 0.3]].map(([x, z], i) => (
        <mesh key={`leg-${i}`} position={[x, COURTROOM_CONFIG.counselTables.tableTopY / 2, z]} castShadow>
          {/* Legs span from floor (y=0) up to the underside of the tabletop */}
          <boxGeometry args={[0.08, COURTROOM_CONFIG.counselTables.tableTopY, 0.08]} />
          <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
        </mesh>
      ))}
      
      {/* Executive leather chair - behind the desk, facing the judge */}
      <group position={[0, 0, chairOffset]}>
        {/* Chair seat - padded */}
        <mesh position={[0, 0.45, 0]} castShadow>
          <boxGeometry args={[0.6, 0.1, 0.5]} />
          <meshStandardMaterial color={COLORS.fabricLeather} roughness={0.7} />
        </mesh>
        {/* Seat cushion */}
        <mesh position={[0, 0.51, 0]} castShadow>
          <boxGeometry args={[0.55, 0.06, 0.45]} />
          <meshStandardMaterial color={COLORS.fabricLeather} roughness={0.4} metalness={0.1} />
        </mesh>
        
        {/* High back with curves */}
        <mesh position={[0, 0.95, 0.22]} castShadow>
          <boxGeometry args={[0.6, 0.9, 0.08]} />
          <meshStandardMaterial color={COLORS.fabricLeather} roughness={0.6} />
        </mesh>
        {/* Back leather padding */}
        <mesh position={[0, 0.95, 0.17]} castShadow>
          <boxGeometry args={[0.5, 0.75, 0.06]} />
          <meshStandardMaterial color={COLORS.fabricLeather} roughness={0.4} metalness={0.1} />
        </mesh>
        {/* Back cushion detail - vertical stitching pattern */}
        {[-0.15, 0, 0.15].map((x, i) => (
          <mesh key={`stitch-${i}`} position={[x, 0.95, 0.19]} castShadow>
            <boxGeometry args={[0.03, 0.7, 0.02]} />
            <meshStandardMaterial color={COLORS.fabricLeather} roughness={0.5} />
          </mesh>
        ))}
        
        {/* Armrests - executive style */}
        {[-0.35, 0.35].map((x, i) => (
          <group key={`arm-${i}`} position={[x, 0.65, 0]}>
            {/* Armrest pad */}
            <mesh position={[0, 0, 0]} castShadow>
              <boxGeometry args={[0.1, 0.06, 0.4]} />
              <meshStandardMaterial color={COLORS.fabricLeather} roughness={0.4} metalness={0.1} />
            </mesh>
            {/* Armrest support */}
            <mesh position={[0, -0.15, 0.15]} castShadow>
              <boxGeometry args={[0.06, 0.3, 0.06]} />
              <meshStandardMaterial color={COLORS.fabricLeather} roughness={0.6} />
            </mesh>
          </group>
        ))}
        
        {/* Headrest bump */}
        <mesh position={[0, 1.35, 0.2]} castShadow>
          <boxGeometry args={[0.4, 0.15, 0.08]} />
          <meshStandardMaterial color={COLORS.fabricLeather} roughness={0.4} metalness={0.1} />
        </mesh>
        
        {/* Five-star wheel base */}
        <mesh position={[0, 0.175, 0]} castShadow>
          {/* Base cylinder touches the floor at y=0 */}
          <cylinderGeometry args={[0.05, 0.05, 0.35, 8]} />
          <meshStandardMaterial color="#1a1a1a" roughness={0.3} metalness={0.7} />
        </mesh>
        {/* Base star */}
        {Array.from({ length: 5 }).map((_, i) => {
          const angle = (i * Math.PI * 2) / 5
          return (
            <mesh key={`wheel-${i}`} position={[Math.cos(angle) * 0.25, 0.03, Math.sin(angle) * 0.25]} castShadow>
              <boxGeometry args={[0.06, 0.04, 0.3]} />
              <meshStandardMaterial color="#1a1a1a" roughness={0.3} metalness={0.7} />
            </mesh>
          )
        })}
      </group>
      
      {/* Name plate on front */}
      <mesh position={[0, 0.8, -0.42]} castShadow>
        <boxGeometry args={[0.5, 0.08, 0.04]} />
        <meshStandardMaterial color={COLORS.brass} roughness={0.3} metalness={0.6} />
      </mesh>
      {/* Label */}
      <Text
        position={[0, 1.1, -0.4]}
        fontSize={0.1}
        color="#5c4d3d"
        anchorX="center"
        anchorY="middle"
      >
        {label}
      </Text>
    </group>
  )
})

// --- MAIN COURTROOM ASSEMBLY ---
// Combines all courtroom elements with proper layout
// Memoized to prevent re-renders (static geometry)
const Courtroom = memo(function Courtroom() {
  // Counsel table positions - in the "well" area between judge and bar
  // Tables are positioned to not intersect with the bar divider (at z=3)
  const defenseTableX = COURTROOM_CONFIG.counselTables.defenseX
  const plaintiffTableX = COURTROOM_CONFIG.counselTables.plaintiffX
  const counselTableZ = COURTROOM_CONFIG.counselTables.tableZ
  
  return (
    <group>
      {/* === STRUCTURE === */}
      <Floor />
      <Walls />
      
      {/* === JUDGE'S AREA (front of courtroom) === */}
      <JudgeBench />
      <AmericanFlag />
      <StateFlag />
      <CourtSeal />
      
      {/* === WELL AREA (between judge and bar) === */}
      <WitnessStand />
      <JuryBox />
      
      {/* Counsel tables - both face the judge */}
      {/* Defense chair is pushed further back (user stands in front of it) */}
      <CounselDesk 
        position={[defenseTableX, 0, counselTableZ]} 
        label="DEFENSE" 
        chairOffset={COURTROOM_CONFIG.counselTables.defenseChairZOffset} 
      />
      <CounselDesk position={[plaintiffTableX, 0, counselTableZ]} label="PLAINTIFF" />
      
      {/* === PUBLIC AREA (behind the bar) === */}
      <GallerySeating />
    </group>
  )
})

function LoadingAvatar() {
  return (
    <mesh>
      <sphereGeometry args={[0.3, 32, 32]} />
      <meshStandardMaterial color="#3b82f6" wireframe />
    </mesh>
  )
}

// Keyboard-controlled camera for automated testing and accessibility
function KeyboardCameraControls({ controlsRef }: { controlsRef: React.RefObject<OrbitControlsImpl> }) {
  const { camera } = useThree()
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!controlsRef.current) return
      
      const rotateAmount = 0.1 // radians per keypress
      const controls = controlsRef.current
      
      switch (e.key) {
        case 'ArrowLeft':
          // Rotate camera left (increase azimuth angle)
          controls.setAzimuthalAngle(controls.getAzimuthalAngle() + rotateAmount)
          controls.update()
          break
        case 'ArrowRight':
          // Rotate camera right (decrease azimuth angle)
          controls.setAzimuthalAngle(controls.getAzimuthalAngle() - rotateAmount)
          controls.update()
          break
        case 'ArrowUp':
          // Rotate camera up (decrease polar angle)
          controls.setPolarAngle(Math.max(controls.getPolarAngle() - rotateAmount, Math.PI / 4))
          controls.update()
          break
        case 'ArrowDown':
          // Rotate camera down (increase polar angle)
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

// ============================================================================
// COURTROOM SCENE COMPONENT
// ============================================================================
// This component handles all 3D rendering of the courtroom.
// It is separated from TTS logic for modularity and future extensibility.
// ============================================================================

interface CourtroomSceneProps {
  speakingRole: SpeakingRole
  lipsyncManager: Lipsync | null
  orbitControlsRef: React.MutableRefObject<OrbitControlsImpl | null>
}

function CourtroomScene({ speakingRole, lipsyncManager, orbitControlsRef }: CourtroomSceneProps) {
  return (
    <Canvas
      camera={{ 
        position: SCENE_CONFIG.camera.position as [number, number, number],
        fov: SCENE_CONFIG.camera.fov
      }}
      shadows="soft"
      dpr={[1, 1.5]}  // Limit device pixel ratio for performance
      style={{ background: 'linear-gradient(180deg, #1a1a2e 0%, #0d0d15 100%)' }}
      gl={{ 
        antialias: true,
        powerPreference: 'high-performance',
        stencil: false,  // Disable stencil buffer if not needed
      }}
    >
      {/* Fog for depth and atmosphere */}
      <fog attach="fog" args={['#1a1a2e', 6, 14]} />
      
      {/* Ambient lighting - warm courtroom feel */}
      <ambientLight intensity={0.5} color="#fff5e6" />
      
      {/* Main overhead light - reduced shadow map for performance */}
      <directionalLight 
        position={[0, 5, 0]} 
        intensity={0.7} 
        castShadow
        shadow-mapSize={[1024, 1024]}  // Reduced from 2048 for performance
        shadow-camera-far={12}
        shadow-camera-left={-5}
        shadow-camera-right={5}
        shadow-camera-top={5}
        shadow-camera-bottom={-5}
        shadow-bias={-0.001}
        color="#fff8f0"
      />
      
      {/* Fill lights - no shadows for performance */}
      <directionalLight position={[-3, 4, 1]} intensity={0.3} color="#e6f0ff" />
      <directionalLight position={[3, 4, 1]} intensity={0.3} color="#fff0e6" />
      
      {/* Spotlight on judge - no shadow for performance */}
      <spotLight
        position={[0, 4, -2]}
        angle={0.6}
        penumbra={0.5}
        intensity={1.2}
        color="#fff5e0"
      />
      
      {/* Light on opposing counsel */}
      <spotLight
        position={[1.5, 3, 0]}
        angle={0.7}
        penumbra={0.5}
        intensity={0.8}
        color="#fff8f0"
      />
      
      <Suspense fallback={<LoadingAvatar />}>
        {/* Apply a single uniform scale to the entire courtroom and avatars */}
        <group scale={[COURTROOM_CONFIG.scale, COURTROOM_CONFIG.scale, COURTROOM_CONFIG.scale]}>
          {/* Courtroom Environment */}
          <Courtroom />
          
          {/* Judge Avatar - seated in chair behind the bench */}
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
            label="Judge"
            sitting={true}
            poseConfig={JUDGE_AVATAR_CONFIG.pose}
          />
          
          {/* Opposing Counsel Avatar - seated at plaintiff desk chair */}
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
            label="Counsel"
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
      
      {/* Keyboard controls for camera rotation (arrow keys) */}
      <KeyboardCameraControls controlsRef={orbitControlsRef} />
    </Canvas>
  )
}

// ============================================================================
// MAIN AVATAR PAGE COMPONENT
// ============================================================================
// This component handles UI and TTS logic. The 3D scene is rendered by
// CourtroomScene. When you're ready to replace TTS, modify the hooks and
// callbacks below without touching the 3D rendering code.
// ============================================================================

export default function Avatar() {
  const [judgeText, setJudgeText] = useState('')
  const [counselText, setCounselText] = useState('')
  const [speakingRole, setSpeakingRole] = useState<SpeakingRole>(null)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [judgeVoice, setJudgeVoice] = useState<string>('')
  const [counselVoice, setCounselVoice] = useState<string>('')
  
  const lipsyncRef = useRef<Lipsync | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const orbitControlsRef = useRef<OrbitControlsImpl>(null)

  // Initialize lipsync manager
  useEffect(() => {
    lipsyncRef.current = new Lipsync()
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close()
      }
    }
  }, [])

  // Load available voices
  useEffect(() => {
    const loadVoices = () => {
      const availableVoices = speechSynthesis.getVoices()
      setVoices(availableVoices)
      if (availableVoices.length > 0) {
        // Find distinct voices for judge and counsel
        const englishVoices = availableVoices.filter(v => v.lang.startsWith('en'))
        const maleVoice = englishVoices.find(v => 
          v.name.toLowerCase().includes('male') || 
          v.name.toLowerCase().includes('daniel') ||
          v.name.toLowerCase().includes('james')
        )
        const femaleVoice = englishVoices.find(v => 
          v.name.toLowerCase().includes('female') || 
          v.name.toLowerCase().includes('samantha') ||
          v.name.toLowerCase().includes('karen')
        )
        
        if (!judgeVoice) {
          setJudgeVoice(maleVoice?.name || englishVoices[0]?.name || availableVoices[0].name)
        }
        if (!counselVoice) {
          setCounselVoice(femaleVoice?.name || englishVoices[1]?.name || englishVoices[0]?.name || availableVoices[0].name)
        }
      }
    }

    loadVoices()
    speechSynthesis.onvoiceschanged = loadVoices

    return () => {
      speechSynthesis.cancel()
    }
  }, [judgeVoice, counselVoice])

  const speak = (role: 'judge' | 'counsel') => {
    const text = role === 'judge' ? judgeText : counselText
    if (!text.trim()) return

    speechSynthesis.cancel()

    const utterance = new SpeechSynthesisUtterance(text)
    const voiceName = role === 'judge' ? judgeVoice : counselVoice
    const voice = voices.find(v => v.name === voiceName)
    if (voice) utterance.voice = voice
    
    // Slightly different speech parameters for each role
    utterance.rate = role === 'judge' ? 0.9 : 1.0
    utterance.pitch = role === 'judge' ? 0.8 : 1.1

    utterance.onstart = () => {
      setSpeakingRole(role)
    }

    utterance.onend = () => {
      setSpeakingRole(null)
    }

    utterance.onerror = () => {
      setSpeakingRole(null)
    }

    speechSynthesis.speak(utterance)
  }

  const stopSpeaking = () => {
    speechSynthesis.cancel()
    setSpeakingRole(null)
  }

  return (
    <div className="avatar-page">
      <nav className="nav">
        <Link to="/" className="nav-link">Brief Analysis</Link>
        <span className="nav-brand">Courtroom Simulator</span>
        <Link to="/playground" className="nav-link">Playground</Link>
      </nav>

      <main className="avatar-main-3d courtroom-main">
        <div className="avatar-container-3d courtroom-layout">
          {/* 3D Courtroom Scene - separated from TTS logic */}
          <div className="avatar-canvas-container courtroom-canvas">
            <CourtroomScene 
              speakingRole={speakingRole}
              lipsyncManager={lipsyncRef.current}
              orbitControlsRef={orbitControlsRef}
            />
            
            {speakingRole && (
              <div className="speaking-indicator-3d">
                <span className="wave"></span>
                <span className="wave"></span>
                <span className="wave"></span>
                <span className="speaking-text">
                  {speakingRole === 'judge' ? 'Judge' : 'Counsel'} speaking...
                </span>
              </div>
            )}
          </div>

          {/* Controls Panel */}
          <div className="avatar-controls-3d courtroom-controls">
            {/* Judge Section */}
            <section className={`control-section ${speakingRole === 'judge' ? 'speaking-active' : ''}`}>
              <h3>Judge</h3>
              
              <div className="control-group">
                <label>Judge's statement</label>
                <textarea
                  value={judgeText}
                  onChange={(e) => setJudgeText(e.target.value)}
                  placeholder="Enter what the judge will say..."
                  rows={3}
                />
              </div>

              <div className="control-group">
                <label>Voice</label>
                <select
                  value={judgeVoice}
                  onChange={(e) => setJudgeVoice(e.target.value)}
                >
                  {voices.map(voice => (
                    <option key={voice.name} value={voice.name}>
                      {voice.name}
                    </option>
                  ))}
                </select>
              </div>

              <button
                className="btn-primary-large"
                onClick={() => speak('judge')}
                disabled={!judgeText.trim() || speakingRole !== null}
              >
                {speakingRole === 'judge' ? 'Speaking...' : 'Judge Speaks'}
              </button>
            </section>

            {/* Counsel Section */}
            <section className={`control-section ${speakingRole === 'counsel' ? 'speaking-active' : ''}`}>
              <h3>Opposing Counsel</h3>
              
              <div className="control-group">
                <label>Counsel's statement</label>
                <textarea
                  value={counselText}
                  onChange={(e) => setCounselText(e.target.value)}
                  placeholder="Enter what the counsel will say..."
                  rows={3}
                />
              </div>

              <div className="control-group">
                <label>Voice</label>
                <select
                  value={counselVoice}
                  onChange={(e) => setCounselVoice(e.target.value)}
                >
                  {voices.map(voice => (
                    <option key={voice.name} value={voice.name}>
                      {voice.name}
                    </option>
                  ))}
                </select>
              </div>

              <button
                className="btn-primary-large"
                onClick={() => speak('counsel')}
                disabled={!counselText.trim() || speakingRole !== null}
              >
                {speakingRole === 'counsel' ? 'Speaking...' : 'Counsel Speaks'}
              </button>
            </section>

            {/* Stop button when speaking */}
            {speakingRole && (
              <button className="btn-ghost stop-btn" onClick={stopSpeaking}>
                Stop Speaking
              </button>
            )}

            {/* Instructions */}
            <section className="control-section instructions">
              <h3>Camera Controls</h3>
              <ul>
                <li><strong>Rotate:</strong> Click and drag</li>
                <li><strong>Zoom:</strong> Scroll wheel</li>
                <li><strong>Pan:</strong> Right-click and drag</li>
              </ul>
            </section>
          </div>
        </div>
      </main>
    </div>
  )
}

// Preload avatars (same URL used for both currently)
useGLTF.preload(JUDGE_AVATAR_URL)
