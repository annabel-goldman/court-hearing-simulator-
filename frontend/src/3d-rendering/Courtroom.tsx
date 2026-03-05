/**
 * Courtroom Component
 * 
 * Main 3D courtroom assembly containing all static geometry.
 * All sub-components are memoized to prevent unnecessary re-renders.
 */

import { memo, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import {
  CHAIR_CONSTANTS,
  FURNITURE_GLB_SETTINGS,
  SCENE_PRESETS,
  WINDOW_SKY_BACKDROP_SETTINGS,
  type SceneConfig,
} from './scenePresets'

// Get scene config
const SCENE_CONFIG: SceneConfig = SCENE_PRESETS.default
const ROOM = SCENE_CONFIG.room
const LAYOUT = SCENE_CONFIG.layout
const COLORS = SCENE_CONFIG.colors
const COURTROOM_CONFIG = {
  scale: SCENE_CONFIG.sceneScale,
  judgeBench: SCENE_CONFIG.judgeBench,
  counselTables: SCENE_CONFIG.counselTables,
}
const JUDGE_DESK_GLB = FURNITURE_GLB_SETTINGS.judgeDesk
const LAWYER_DESK_GLB = FURNITURE_GLB_SETTINGS.lawyerDesk
const CHAIR_GLB = FURNITURE_GLB_SETTINGS.chair
const FLAG_GLB = FURNITURE_GLB_SETTINGS.flag
const PEW_GLB = FURNITURE_GLB_SETTINGS.pew
const EMBLEM_GLB = FURNITURE_GLB_SETTINGS.emblem
const WINDOW_GLB = FURNITURE_GLB_SETTINGS.window
const BEAM_GLB = FURNITURE_GLB_SETTINGS.beam
const SEPARATOR_Z = LAYOUT.galleryStart + 0.5
const FIRST_GALLERY_PEW_Z = SEPARATOR_Z + LAYOUT.gallerySpacing
const GALLERY_PEW_ROWS = 1

interface ScaledGlbProps {
  url: string
  position: [number, number, number]
  rotation?: [number, number, number]
  scale: number
}

const ScaledGlb = memo(function ScaledGlb({
  url,
  position,
  rotation = [0, 0, 0],
  scale,
}: ScaledGlbProps) {
  const { scene } = useGLTF(url)

  const model = useMemo(() => {
    const clone = scene.clone(true)
    clone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true
        child.receiveShadow = true
      }
    })
    return clone
  }, [scene])

  const layout = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const maxDimension = Math.max(size.x, size.y, size.z, 0.001)
    const normalizedScale = scale / maxDimension

    return {
      scale: normalizedScale,
      offset: [-center.x, -box.min.y, -center.z] as [number, number, number],
    }
  }, [scene, scale])

  return (
    <group position={position} rotation={rotation}>
      <group scale={[layout.scale, layout.scale, layout.scale]}>
        <primitive object={model} position={layout.offset} />
      </group>
    </group>
  )
})

// --- FLOOR ---
const Floor = memo(function Floor() {
  const floorY = 0
  const floorCenter = (ROOM.frontWall + ROOM.backWall) / 2
  const floorLength = ROOM.backWall - ROOM.frontWall
  
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, floorY, floorCenter]} receiveShadow>
        <planeGeometry args={[ROOM.width, floorLength]} />
        <meshStandardMaterial color={COLORS.woodMedium} roughness={0.52} metalness={0.04} />
      </mesh>
      
      {[ROOM.leftWall + 0.5, ROOM.rightWall - 0.5].map((x, i) => (
        <mesh key={`floor-border-x-${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[x, floorY + 0.001, floorCenter]} receiveShadow>
          <planeGeometry args={[0.5, floorLength]} />
          <meshStandardMaterial color={COLORS.woodDark} roughness={0.58} />
        </mesh>
      ))}
      
      {[ROOM.frontWall + 0.5, ROOM.backWall - 0.5].map((z, i) => (
        <mesh key={`floor-border-z-${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[0, floorY + 0.001, z]} receiveShadow>
          <planeGeometry args={[ROOM.width, 0.5]} />
          <meshStandardMaterial color={COLORS.woodDark} roughness={0.58} />
        </mesh>
      ))}
    </group>
  )
})

// --- WALLS ---
const Walls = memo(function Walls() {
  const { scene: windowScene } = useGLTF(WINDOW_GLB.url)
  const wallCenterY = ROOM.height / 2
  const roomCenterZ = (ROOM.frontWall + ROOM.backWall) / 2
  const halfSideWallLength = (ROOM.backWall - ROOM.frontWall) / 2
  const sideWallLength = ROOM.backWall - ROOM.frontWall
  const sideWindowSillY = WINDOW_GLB.positionOffset[1]
  const sideWindowInset = ROOM.wallThickness / 2 + WINDOW_GLB.positionOffset[2]
  const sideWindowZPositions = useMemo(
    () => [
      ROOM.frontWall + sideWallLength / 3 + WINDOW_GLB.positionOffset[0],
      ROOM.frontWall + (2 * sideWallLength) / 3 + WINDOW_GLB.positionOffset[0],
    ] as const,
    [sideWallLength]
  )

  const sideWindowBackdrop = useMemo(() => {
    const box = new THREE.Box3().setFromObject(windowScene)
    const size = box.getSize(new THREE.Vector3())
    const maxDimension = Math.max(size.x, size.y, size.z, 0.001)
    const normalizedScale = WINDOW_GLB.scale / maxDimension
    const width = Math.max(size.x, size.z) * normalizedScale * WINDOW_SKY_BACKDROP_SETTINGS.widthScale
    const height = size.y * normalizedScale * WINDOW_SKY_BACKDROP_SETTINGS.heightScale

    return { width, height }
  }, [windowScene])

  const skyBackdropY = sideWindowSillY + sideWindowBackdrop.height / 2 + WINDOW_SKY_BACKDROP_SETTINGS.yOffset
  const skyBackdropOffset = ROOM.wallThickness / 2 + WINDOW_SKY_BACKDROP_SETTINGS.xOffsetFromWall
  const sideWallOpeningWidth = sideWindowBackdrop.width * 1.06
  const sideWallOpeningHeight = Math.min(sideWindowBackdrop.height * 1.06, ROOM.height - 0.2)
  const openingCenterY = THREE.MathUtils.clamp(
    skyBackdropY,
    sideWallOpeningHeight / 2 + 0.05,
    ROOM.height - sideWallOpeningHeight / 2 - 0.05
  )
  const openingBottomY = openingCenterY - sideWallOpeningHeight / 2
  const openingTopY = openingCenterY + sideWallOpeningHeight / 2
  const lowerBandHeight = Math.max(openingBottomY, 0)
  const upperBandHeight = Math.max(ROOM.height - openingTopY, 0)

  const sideOpeningCenters = useMemo(
    () => sideWindowZPositions.map((windowZ) => windowZ - roomCenterZ).sort((a, b) => a - b),
    [roomCenterZ, sideWindowZPositions]
  )

  const firstOpeningLeft = sideOpeningCenters[0] - sideWallOpeningWidth / 2
  const firstOpeningRight = sideOpeningCenters[0] + sideWallOpeningWidth / 2
  const secondOpeningLeft = sideOpeningCenters[1] - sideWallOpeningWidth / 2
  const secondOpeningRight = sideOpeningCenters[1] + sideWallOpeningWidth / 2
  const sideWallSegments = [
    {
      centerX: (-halfSideWallLength + firstOpeningLeft) / 2,
      width: Math.max(firstOpeningLeft + halfSideWallLength, 0),
    },
    {
      centerX: (firstOpeningRight + secondOpeningLeft) / 2,
      width: Math.max(secondOpeningLeft - firstOpeningRight, 0),
    },
    {
      centerX: (secondOpeningRight + halfSideWallLength) / 2,
      width: Math.max(halfSideWallLength - secondOpeningRight, 0),
    },
  ]
  
  return (
    <group>
      {/* Front Wall */}
      <mesh position={[0, wallCenterY, ROOM.frontWall]} receiveShadow>
        <boxGeometry args={[ROOM.width, ROOM.height, ROOM.wallThickness]} />
        <meshStandardMaterial color={COLORS.wallPaint} roughness={0.9} />
      </mesh>
      <ScaledGlb
        url={BEAM_GLB.url}
        position={[
          BEAM_GLB.positionOffset[0],
          BEAM_GLB.positionOffset[1],
          ROOM.frontWall + BEAM_GLB.positionOffset[2],
        ]}
        rotation={BEAM_GLB.rotation}
        scale={BEAM_GLB.scale}
      />
      
      {/* Back Wall */}
      <mesh position={[0, wallCenterY, ROOM.backWall]} receiveShadow>
        <boxGeometry args={[ROOM.width, ROOM.height, ROOM.wallThickness]} />
        <meshStandardMaterial color={COLORS.wallPaint} roughness={0.9} />
      </mesh>
      
      {/* Left Wall with two window openings */}
      <group position={[ROOM.leftWall, 0, roomCenterZ]} rotation={[0, Math.PI / 2, 0]}>
        {lowerBandHeight > 0 && (
          <mesh position={[0, lowerBandHeight / 2, 0]} receiveShadow>
            <boxGeometry args={[sideWallLength, lowerBandHeight, ROOM.wallThickness]} />
            <meshStandardMaterial color={COLORS.wallPaint} roughness={0.9} />
          </mesh>
        )}
        {upperBandHeight > 0 && (
          <mesh position={[0, openingTopY + upperBandHeight / 2, 0]} receiveShadow>
            <boxGeometry args={[sideWallLength, upperBandHeight, ROOM.wallThickness]} />
            <meshStandardMaterial color={COLORS.wallPaint} roughness={0.9} />
          </mesh>
        )}
        {sideWallSegments.map((segment, index) =>
          segment.width > 0 ? (
            <mesh key={`left-wall-mid-segment-${index}`} position={[segment.centerX, openingCenterY, 0]} receiveShadow>
              <boxGeometry args={[segment.width, sideWallOpeningHeight, ROOM.wallThickness]} />
              <meshStandardMaterial color={COLORS.wallPaint} roughness={0.9} />
            </mesh>
          ) : null
        )}
      </group>
      
      {/* Right Wall with two window openings */}
      <group position={[ROOM.rightWall, 0, roomCenterZ]} rotation={[0, Math.PI / 2, 0]}>
        {lowerBandHeight > 0 && (
          <mesh position={[0, lowerBandHeight / 2, 0]} receiveShadow>
            <boxGeometry args={[sideWallLength, lowerBandHeight, ROOM.wallThickness]} />
            <meshStandardMaterial color={COLORS.wallPaint} roughness={0.9} />
          </mesh>
        )}
        {upperBandHeight > 0 && (
          <mesh position={[0, openingTopY + upperBandHeight / 2, 0]} receiveShadow>
            <boxGeometry args={[sideWallLength, upperBandHeight, ROOM.wallThickness]} />
            <meshStandardMaterial color={COLORS.wallPaint} roughness={0.9} />
          </mesh>
        )}
        {sideWallSegments.map((segment, index) =>
          segment.width > 0 ? (
            <mesh key={`right-wall-mid-segment-${index}`} position={[segment.centerX, openingCenterY, 0]} receiveShadow>
              <boxGeometry args={[segment.width, sideWallOpeningHeight, ROOM.wallThickness]} />
              <meshStandardMaterial color={COLORS.wallPaint} roughness={0.9} />
            </mesh>
          ) : null
        )}
      </group>

      {sideWindowZPositions.map((windowZ, index) => {
        const skyBackdropZ = windowZ + WINDOW_SKY_BACKDROP_SETTINGS.zOffset
        return (
          <group key={`side-window-pair-${index}`}>
            <ScaledGlb
              url={WINDOW_GLB.url}
              position={[ROOM.leftWall + sideWindowInset, sideWindowSillY, windowZ]}
              rotation={[
                WINDOW_GLB.rotation[0],
                WINDOW_GLB.rotation[1] + Math.PI / 2,
                WINDOW_GLB.rotation[2],
              ]}
              scale={WINDOW_GLB.scale}
            />
            <mesh
              position={[ROOM.leftWall - skyBackdropOffset, skyBackdropY, skyBackdropZ]}
              rotation={[0, Math.PI / 2, 0]}
            >
              <planeGeometry args={[sideWindowBackdrop.width, sideWindowBackdrop.height]} />
              <meshBasicMaterial color="#79bfff" toneMapped={false} />
            </mesh>

            <ScaledGlb
              url={WINDOW_GLB.url}
              position={[ROOM.rightWall - sideWindowInset, sideWindowSillY, windowZ]}
              rotation={[
                WINDOW_GLB.rotation[0],
                WINDOW_GLB.rotation[1] - Math.PI / 2,
                WINDOW_GLB.rotation[2],
              ]}
              scale={WINDOW_GLB.scale}
            />
            <mesh
              position={[ROOM.rightWall + skyBackdropOffset, skyBackdropY, skyBackdropZ]}
              rotation={[0, -Math.PI / 2, 0]}
            >
              <planeGeometry args={[sideWindowBackdrop.width, sideWindowBackdrop.height]} />
              <meshBasicMaterial color="#79bfff" toneMapped={false} />
            </mesh>
          </group>
        )
      })}
      
      {/* Ceiling */}
      <mesh position={[0, ROOM.height, roomCenterZ]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[ROOM.width, sideWallLength]} />
        <meshStandardMaterial color={COLORS.ceiling} roughness={0.9} />
      </mesh>
    </group>
  )
})

// --- JUDGE'S BENCH ---
const JudgeBench = memo(function JudgeBench() {
  const benchZ = LAYOUT.judgeBench
  const { tiers, desk, chair, positionOffset, stepFrontInset } = COURTROOM_CONFIG.judgeBench
  const { tier1 } = tiers
  const benchBaseY = tier1.height

  return (
    <group position={[positionOffset[0], positionOffset[1], benchZ + positionOffset[2]]}>
      {/* Single raised tier */}
      <mesh position={[0, tier1.height / 2, tier1.depth / 2 - stepFrontInset]} castShadow receiveShadow>
        <boxGeometry args={[tier1.width, tier1.height, tier1.depth]} />
        <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
      </mesh>

      {/* GLB Desk */}
      <ScaledGlb
        url={JUDGE_DESK_GLB.url}
        position={[
          JUDGE_DESK_GLB.positionOffset[0],
          benchBaseY + JUDGE_DESK_GLB.positionOffset[1],
          (desk.zOffset || 0) + JUDGE_DESK_GLB.positionOffset[2],
        ]}
        rotation={JUDGE_DESK_GLB.rotation}
        scale={JUDGE_DESK_GLB.scale}
      />
      
      {/* Judge's Chair */}
      <ScaledGlb
        url={CHAIR_GLB.url}
        position={[
          CHAIR_GLB.positionOffset[0],
          benchBaseY + CHAIR_GLB.positionOffset[1],
          chair.zOffset + CHAIR_GLB.positionOffset[2],
        ]}
        rotation={[
          CHAIR_GLB.rotation[0],
          CHAIR_GLB.rotation[1] + CHAIR_CONSTANTS.location.judge.rotationYOffset,
          CHAIR_GLB.rotation[2],
        ]}
        scale={CHAIR_GLB.scale}
      />
    </group>
  )
})

// --- FLAG ---
const JudgeFlag = memo(function JudgeFlag() {
  const flagZ = ROOM.frontWall + FLAG_GLB.positionOffset[2]

  return (
    <ScaledGlb
      url={FLAG_GLB.url}
      position={[FLAG_GLB.positionOffset[0], FLAG_GLB.positionOffset[1], flagZ]}
      rotation={FLAG_GLB.rotation}
      scale={FLAG_GLB.scale}
    />
  )
})

// --- EMBLEM ---
const JudgeEmblem = memo(function JudgeEmblem() {
  const emblemZ = ROOM.frontWall + EMBLEM_GLB.positionOffset[2]

  return (
    <ScaledGlb
      url={EMBLEM_GLB.url}
      position={[EMBLEM_GLB.positionOffset[0], EMBLEM_GLB.positionOffset[1], emblemZ]}
      rotation={EMBLEM_GLB.rotation}
      scale={EMBLEM_GLB.scale}
    />
  )
})

// --- GALLERY SEATING ---
const GallerySeating = memo(function GallerySeating() {
  const barZ = SEPARATOR_Z
  const benchRows = GALLERY_PEW_ROWS
  const firstRowZ = FIRST_GALLERY_PEW_Z
  const rowSpacing = LAYOUT.gallerySpacing
  
  return (
    <group>
      {/* Separator Pew (replaces old bar divider) */}
      <group position={[0, 0, barZ]}>
        <ScaledGlb
          url={PEW_GLB.url}
          position={PEW_GLB.positionOffset}
          rotation={PEW_GLB.rotation}
          scale={PEW_GLB.scale}
        />
      </group>
      
      {/* Gallery Benches */}
      {Array.from({ length: benchRows }).map((_, row) => {
        const rowZ = firstRowZ + (row * rowSpacing)
        return (
          <group key={`gallery-row-${row}`} position={[0, 0, rowZ]}>
            <ScaledGlb
              url={PEW_GLB.url}
              position={PEW_GLB.positionOffset}
              rotation={PEW_GLB.rotation}
              scale={PEW_GLB.scale}
            />
          </group>
        )
      })}
      
    </group>
  )
})

// --- COUNSEL DESK ---
const CounselDesk = memo(function CounselDesk({ position, chairOffset = 0.65 }: { position: [number, number, number], chairOffset?: number }) {
  return (
    <group position={position}>
      <ScaledGlb
        url={LAWYER_DESK_GLB.url}
        position={LAWYER_DESK_GLB.positionOffset}
        rotation={LAWYER_DESK_GLB.rotation}
        scale={LAWYER_DESK_GLB.scale}
      />
      
      {/* Chair */}
      <ScaledGlb
        url={CHAIR_GLB.url}
        position={[
          CHAIR_GLB.positionOffset[0],
          CHAIR_GLB.positionOffset[1],
          chairOffset + CHAIR_GLB.positionOffset[2],
        ]}
        rotation={CHAIR_GLB.rotation}
        scale={CHAIR_GLB.scale}
      />
      
    </group>
  )
})

// --- MAIN COURTROOM ASSEMBLY ---
export const Courtroom = memo(function Courtroom() {
  const defenseTableX = COURTROOM_CONFIG.counselTables.defenseX
  const plaintiffTableX = COURTROOM_CONFIG.counselTables.plaintiffX
  const counselTableZ = COURTROOM_CONFIG.counselTables.tableZ
  
  return (
    <group>
      <Floor />
      <Walls />
      <JudgeBench />
      <JudgeFlag />
      <JudgeEmblem />
      <CounselDesk 
        position={[defenseTableX, 0, counselTableZ]} 
        chairOffset={COURTROOM_CONFIG.counselTables.defenseChairZOffset} 
      />
      <CounselDesk position={[plaintiffTableX, 0, counselTableZ]} />
      <GallerySeating />
    </group>
  )
})

useGLTF.preload(JUDGE_DESK_GLB.url)
useGLTF.preload(FLAG_GLB.url)
useGLTF.preload(CHAIR_GLB.url)
useGLTF.preload(LAWYER_DESK_GLB.url)
useGLTF.preload(PEW_GLB.url)
useGLTF.preload(EMBLEM_GLB.url)
useGLTF.preload(WINDOW_GLB.url)
useGLTF.preload(BEAM_GLB.url)
