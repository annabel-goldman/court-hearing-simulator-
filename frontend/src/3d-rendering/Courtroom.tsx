/**
 * Courtroom Component
 * 
 * Main 3D courtroom assembly containing all static geometry.
 * All sub-components are memoized to prevent unnecessary re-renders.
 */

import { memo } from 'react'
import { Text } from '@react-three/drei'
import { SCENE_PRESETS, type SceneConfig } from './scenePresets'

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

// --- FLOOR ---
const Floor = memo(function Floor() {
  const floorY = 0
  const floorCenter = (ROOM.frontWall + ROOM.backWall) / 2
  const floorLength = ROOM.backWall - ROOM.frontWall
  
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, floorY, floorCenter]} receiveShadow>
        <planeGeometry args={[ROOM.width, floorLength]} />
        <meshStandardMaterial color={COLORS.marbleCream} roughness={0.3} metalness={0.1} />
      </mesh>
      
      {[ROOM.leftWall + 0.5, ROOM.rightWall - 0.5].map((x, i) => (
        <mesh key={`floor-border-x-${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[x, floorY + 0.001, floorCenter]} receiveShadow>
          <planeGeometry args={[0.5, floorLength]} />
          <meshStandardMaterial color={COLORS.marbleGray} roughness={0.4} />
        </mesh>
      ))}
      
      {[ROOM.frontWall + 0.5, ROOM.backWall - 0.5].map((z, i) => (
        <mesh key={`floor-border-z-${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[0, floorY + 0.001, z]} receiveShadow>
          <planeGeometry args={[ROOM.width, 0.5]} />
          <meshStandardMaterial color={COLORS.marbleGray} roughness={0.4} />
        </mesh>
      ))}
      
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, floorY + 0.01, (LAYOUT.barDivider + ROOM.backWall) / 2]} receiveShadow>
        <planeGeometry args={[3, ROOM.backWall - LAYOUT.barDivider - 1]} />
        <meshStandardMaterial color={COLORS.fabricRed} roughness={0.9} />
      </mesh>
      
      {[-1.45, 1.45].map((x, i) => (
        <mesh key={`carpet-trim-${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[x, floorY + 0.012, (LAYOUT.barDivider + ROOM.backWall) / 2]} receiveShadow>
          <planeGeometry args={[0.08, ROOM.backWall - LAYOUT.barDivider - 1]} />
          <meshStandardMaterial color={COLORS.brass} roughness={0.4} metalness={0.5} />
        </mesh>
      ))}
    </group>
  )
})

// --- WOOD PANELING ---
const WoodPaneling = memo(function WoodPaneling({ position, width, height }: { position: [number, number, number], width: number, height: number }) {
  const panelCount = Math.floor(width / 1.5)
  
  return (
    <group position={position}>
      <mesh receiveShadow>
        <boxGeometry args={[width, height, 0.1]} />
        <meshStandardMaterial color={COLORS.woodMedium} roughness={0.7} />
      </mesh>
      
      {Array.from({ length: panelCount + 1 }).map((_, i) => (
        <mesh key={`panel-div-${i}`} position={[(-width/2) + (i * (width/panelCount)), 0, 0.08]} castShadow>
          <boxGeometry args={[0.05, height * 0.95, 0.04]} />
          <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
        </mesh>
      ))}
      
      <mesh position={[0, height/2 + 0.06, 0.12]} castShadow>
        <boxGeometry args={[width, 0.1, 0.08]} />
        <meshStandardMaterial color={COLORS.woodAccent} roughness={0.5} metalness={0.1} />
      </mesh>
      
      <mesh position={[0, -height/2 + 0.05, 0.12]} castShadow>
        <boxGeometry args={[width, 0.1, 0.07]} />
        <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
      </mesh>
    </group>
  )
})

// --- WALLS ---
const Walls = memo(function Walls() {
  const panelingHeight = ROOM.panelingHeight
  const panelingCenterY = panelingHeight / 2
  const upperWallHeight = ROOM.height - panelingHeight
  const upperWallCenterY = panelingHeight + (upperWallHeight / 2)
  const roomCenterZ = (ROOM.frontWall + ROOM.backWall) / 2
  const sideWallLength = ROOM.backWall - ROOM.frontWall
  const crownY = ROOM.height - 0.2
  const crownSize = 0.18
  
  return (
    <group>
      {/* Front Wall */}
      <mesh position={[0, upperWallCenterY, ROOM.frontWall]} receiveShadow>
        <boxGeometry args={[ROOM.width, upperWallHeight, ROOM.wallThickness]} />
        <meshStandardMaterial color={COLORS.wallPaint} roughness={0.9} />
      </mesh>
      <WoodPaneling position={[0, panelingCenterY, ROOM.frontWall + 0.2]} width={ROOM.width} height={panelingHeight} />
      
      {/* Back Wall */}
      <mesh position={[0, upperWallCenterY, ROOM.backWall]} receiveShadow>
        <boxGeometry args={[ROOM.width, upperWallHeight, ROOM.wallThickness]} />
        <meshStandardMaterial color={COLORS.wallPaint} roughness={0.9} />
      </mesh>
      <WoodPaneling position={[0, panelingCenterY, ROOM.backWall - 0.2]} width={ROOM.width} height={panelingHeight} />
      
      {/* Left Wall */}
      <group position={[ROOM.leftWall, 0, roomCenterZ]} rotation={[0, Math.PI / 2, 0]}>
        <mesh position={[0, upperWallCenterY, 0]} receiveShadow>
          <boxGeometry args={[sideWallLength, upperWallHeight, ROOM.wallThickness]} />
          <meshStandardMaterial color={COLORS.wallPaint} roughness={0.9} />
        </mesh>
        <WoodPaneling position={[0, panelingCenterY, 0.2]} width={sideWallLength} height={panelingHeight} />
      </group>
      
      {/* Right Wall */}
      <group position={[ROOM.rightWall, 0, roomCenterZ]} rotation={[0, Math.PI / 2, 0]}>
        <mesh position={[0, upperWallCenterY, 0]} receiveShadow>
          <boxGeometry args={[sideWallLength, upperWallHeight, ROOM.wallThickness]} />
          <meshStandardMaterial color={COLORS.wallPaint} roughness={0.9} />
        </mesh>
        <WoodPaneling position={[0, panelingCenterY, -0.2]} width={sideWallLength} height={panelingHeight} />
      </group>
      
      {/* Ceiling */}
      <mesh position={[0, ROOM.height, roomCenterZ]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[ROOM.width, sideWallLength]} />
        <meshStandardMaterial color={COLORS.ceiling} roughness={0.9} />
      </mesh>
      
      {/* Crown Molding */}
      <mesh position={[0, crownY, ROOM.frontWall + crownSize / 2 + 0.1]} castShadow>
        <boxGeometry args={[ROOM.width - 0.6, crownSize, crownSize]} />
        <meshStandardMaterial color={COLORS.woodAccent} roughness={0.5} metalness={0.1} />
      </mesh>
      <mesh position={[0, crownY, ROOM.backWall - crownSize / 2 - 0.1]} castShadow>
        <boxGeometry args={[ROOM.width - 0.6, crownSize, crownSize]} />
        <meshStandardMaterial color={COLORS.woodAccent} roughness={0.5} metalness={0.1} />
      </mesh>
      <mesh position={[ROOM.leftWall + crownSize / 2 + 0.1, crownY, roomCenterZ]} castShadow>
        <boxGeometry args={[crownSize, crownSize, sideWallLength - 0.6]} />
        <meshStandardMaterial color={COLORS.woodAccent} roughness={0.5} metalness={0.1} />
      </mesh>
      <mesh position={[ROOM.rightWall - crownSize / 2 - 0.1, crownY, roomCenterZ]} castShadow>
        <boxGeometry args={[crownSize, crownSize, sideWallLength - 0.6]} />
        <meshStandardMaterial color={COLORS.woodAccent} roughness={0.5} metalness={0.1} />
      </mesh>
      
      {/* Wall Sconces */}
      {[-8, -4, 4, 8].map((x, i) => (
        <group key={`sconce-${i}`} position={[x, 4, ROOM.frontWall + 0.4]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.12, 0.12, 0.03, 16]} />
            <meshStandardMaterial color={COLORS.brass} roughness={0.3} metalness={0.7} />
          </mesh>
          <mesh position={[0, 0, 0.12]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.02, 0.02, 0.2, 16]} />
            <meshStandardMaterial color={COLORS.brass} roughness={0.3} metalness={0.7} />
          </mesh>
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
const JudgeBench = memo(function JudgeBench() {
  const benchZ = LAYOUT.judgeBench
  const { tiers, desk, chair } = COURTROOM_CONFIG.judgeBench
  const { tier1, tier2, tier3 } = tiers
  const bench = desk
  const platformTotalHeight = tier1.height + tier2.height + tier3.height
  const benchTop = platformTotalHeight + bench.height

  return (
    <group position={[0, 0, benchZ]}>
      {/* Platform Tiers */}
      <mesh position={[0, tier1.height / 2, tier1.depth / 2 - 0.5]} castShadow receiveShadow>
        <boxGeometry args={[tier1.width, tier1.height, tier1.depth]} />
        <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
      </mesh>
      <mesh position={[0, tier1.height + tier2.height / 2, tier2.depth / 2 - 1]} castShadow receiveShadow>
        <boxGeometry args={[tier2.width, tier2.height, tier2.depth]} />
        <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
      </mesh>
      <mesh position={[0, tier1.height + tier2.height + tier3.height / 2, tier3.depth / 2 - 1.5]} castShadow receiveShadow>
        <boxGeometry args={[tier3.width, tier3.height, tier3.depth]} />
        <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
      </mesh>
      
      {/* U-shaped Desk */}
      {(() => {
        const deskY = platformTotalHeight + bench.height / 2
        const deskZ = bench.zOffset || 0
        const frontDepth = bench.frontPanelDepth || 0.3
        const openingWidth = bench.chairOpeningWidth || 1.4
        const sidePanelWidth = (bench.width - openingWidth) / 2
        const sidePanelDepth = bench.depth - frontDepth
        
        return (
          <>
            <mesh position={[0, deskY, deskZ + frontDepth / 2]} castShadow receiveShadow>
              <boxGeometry args={[bench.width, bench.height, frontDepth]} />
              <meshStandardMaterial color={COLORS.woodMedium} roughness={0.6} />
            </mesh>
            <mesh position={[-(bench.width / 2 - sidePanelWidth / 2), deskY, deskZ - sidePanelDepth / 2]} castShadow receiveShadow>
              <boxGeometry args={[sidePanelWidth, bench.height, sidePanelDepth]} />
              <meshStandardMaterial color={COLORS.woodMedium} roughness={0.6} />
            </mesh>
            <mesh position={[(bench.width / 2 - sidePanelWidth / 2), deskY, deskZ - sidePanelDepth / 2]} castShadow receiveShadow>
              <boxGeometry args={[sidePanelWidth, bench.height, sidePanelDepth]} />
              <meshStandardMaterial color={COLORS.woodMedium} roughness={0.6} />
            </mesh>
            <mesh position={[0, platformTotalHeight + bench.height + 0.05, deskZ - bench.depth / 2 + frontDepth / 2]} castShadow receiveShadow>
              <boxGeometry args={[bench.width + 0.2, 0.1, bench.depth + 0.2]} />
              <meshStandardMaterial color={COLORS.woodLight} roughness={0.4} metalness={0.05} />
            </mesh>
            <mesh position={[0, deskY, deskZ + frontDepth / 2 + 0.06]} castShadow>
              <boxGeometry args={[bench.width - 0.2, bench.height - 0.2, 0.1]} />
              <meshStandardMaterial color={COLORS.woodDark} roughness={0.7} />
            </mesh>
            {[-2.2, 0, 2.2].map((x, i) => (
              <mesh key={`bench-inset-${i}`} position={[x, deskY, deskZ + frontDepth / 2 + 0.12]} castShadow>
                <boxGeometry args={[1.8, 0.9, 0.02]} />
                <meshStandardMaterial color={COLORS.woodMedium} roughness={0.5} />
              </mesh>
            ))}
            <mesh position={[0, platformTotalHeight + bench.height - 0.02, deskZ + frontDepth / 2 + 0.06]} castShadow>
              <boxGeometry args={[bench.width, 0.08, 0.12]} />
              <meshStandardMaterial color={COLORS.brass} roughness={0.3} metalness={0.6} />
            </mesh>
          </>
        )
      })()}
      
      {/* Gavel */}
      <group position={[2.5, benchTop + 0.12, -0.8]}>
        <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.04, 0.04, 0.15, 16]} />
          <meshStandardMaterial color={COLORS.woodDark} roughness={0.5} />
        </mesh>
        <mesh position={[0, -0.03, 0]} rotation={[Math.PI / 6, 0, 0]} castShadow>
          <cylinderGeometry args={[0.015, 0.02, 0.2, 16]} />
          <meshStandardMaterial color={COLORS.woodMedium} roughness={0.5} />
        </mesh>
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
      
      {/* Judge's Chair */}
      <group position={[0, platformTotalHeight, chair.zOffset]}>
        <mesh position={[0, 0.45, 0]} castShadow>
          <boxGeometry args={[0.7, 0.1, 0.6]} />
          <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
        </mesh>
        <mesh position={[0, 1.1, -0.25]} castShadow>
          <boxGeometry args={[0.75, 1.2, 0.08]} />
          <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
        </mesh>
        <mesh position={[0, 1.1, -0.2]} castShadow>
          <boxGeometry args={[0.6, 1, 0.06]} />
          <meshStandardMaterial color={COLORS.fabricRed} roughness={0.9} />
        </mesh>
        {[-0.35, 0.35].map((x, i) => (
          <mesh key={`arm-${i}`} position={[x, 0.6, -0.1]} castShadow>
            <boxGeometry args={[0.08, 0.1, 0.5]} />
            <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
          </mesh>
        ))}
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
const AmericanFlag = memo(function AmericanFlag() {
  const flagZ = ROOM.frontWall + 0.8
  
  return (
    <group position={[-3.5, 0.6, flagZ]}>
      <mesh position={[0, 2, 0]} castShadow>
        <cylinderGeometry args={[0.03, 0.03, 4, 16]} />
        <meshStandardMaterial color={COLORS.brass} roughness={0.3} metalness={0.7} />
      </mesh>
      <mesh position={[0, 4.1, 0]} castShadow>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshStandardMaterial color={COLORS.brass} roughness={0.3} metalness={0.8} />
      </mesh>
      <mesh position={[0.4, 3.3, 0]} castShadow>
        <boxGeometry args={[0.8, 0.5, 0.02]} />
        <meshStandardMaterial color="#bf0a30" roughness={0.9} />
      </mesh>
      <mesh position={[0.15, 3.45, 0.015]} castShadow>
        <boxGeometry args={[0.3, 0.2, 0.01]} />
        <meshStandardMaterial color="#002868" roughness={0.9} />
      </mesh>
      {[3.35, 3.25, 3.15].map((y, i) => (
        <mesh key={`stripe-${i}`} position={[0.4, y, 0.015]} castShadow>
          <boxGeometry args={[0.78, 0.03, 0.01]} />
          <meshStandardMaterial color="#ffffff" roughness={0.9} />
        </mesh>
      ))}
      <mesh position={[0, 0.15, 0]} castShadow>
        <cylinderGeometry args={[0.15, 0.2, 0.3, 16]} />
        <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
      </mesh>
    </group>
  )
})

const StateFlag = memo(function StateFlag() {
  const flagZ = ROOM.frontWall + 0.8
  
  return (
    <group position={[3.5, 0.6, flagZ]}>
      <mesh position={[0, 2, 0]} castShadow>
        <cylinderGeometry args={[0.03, 0.03, 4, 16]} />
        <meshStandardMaterial color={COLORS.brass} roughness={0.3} metalness={0.7} />
      </mesh>
      <mesh position={[0, 4.1, 0]} castShadow>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshStandardMaterial color={COLORS.brass} roughness={0.3} metalness={0.8} />
      </mesh>
      <mesh position={[-0.4, 3.3, 0]} castShadow>
        <boxGeometry args={[0.8, 0.5, 0.02]} />
        <meshStandardMaterial color={COLORS.fabricBlue} roughness={0.9} />
      </mesh>
      <mesh position={[-0.4, 3.3, 0.015]} castShadow>
        <circleGeometry args={[0.15, 32]} />
        <meshStandardMaterial color={COLORS.brass} roughness={0.4} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0.15, 0]} castShadow>
        <cylinderGeometry args={[0.15, 0.2, 0.3, 16]} />
        <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
      </mesh>
    </group>
  )
})

// --- COURT SEAL ---
const CourtSeal = memo(function CourtSeal() {
  const sealY = 4.5
  const sealZ = ROOM.frontWall + 0.3
  
  return (
    <group position={[0, sealY, sealZ]}>
      <mesh castShadow>
        <torusGeometry args={[1, 0.12, 16, 64]} />
        <meshStandardMaterial color={COLORS.brass} roughness={0.3} metalness={0.7} />
      </mesh>
      <mesh position={[0, 0, 0.05]}>
        <circleGeometry args={[0.9, 64]} />
        <meshStandardMaterial color={COLORS.fabricBlue} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0, 0.06]}>
        <torusGeometry args={[0.55, 0.04, 16, 64]} />
        <meshStandardMaterial color={COLORS.brass} roughness={0.3} metalness={0.6} />
      </mesh>
      <mesh position={[0, 0, 0.07]}>
        <circleGeometry args={[0.45, 64]} />
        <meshStandardMaterial color="#1a2d4a" roughness={0.7} />
      </mesh>
      <group position={[0, 0.05, 0.08]}>
        <mesh>
          <boxGeometry args={[0.45, 0.025, 0.015]} />
          <meshStandardMaterial color={COLORS.brass} roughness={0.3} metalness={0.6} />
        </mesh>
        <mesh position={[0, -0.12, 0]}>
          <boxGeometry args={[0.025, 0.25, 0.015]} />
          <meshStandardMaterial color={COLORS.brass} roughness={0.3} metalness={0.6} />
        </mesh>
        <mesh position={[-0.18, -0.08, 0]}>
          <circleGeometry args={[0.07, 32]} />
          <meshStandardMaterial color={COLORS.brass} roughness={0.3} metalness={0.6} />
        </mesh>
        <mesh position={[0.18, -0.08, 0]}>
          <circleGeometry args={[0.07, 32]} />
          <meshStandardMaterial color={COLORS.brass} roughness={0.3} metalness={0.6} />
        </mesh>
      </group>
    </group>
  )
})

// --- WITNESS STAND ---
const WitnessStand = memo(function WitnessStand() {
  const standX = -4
  const standZ = LAYOUT.witnessStand
  const platformSize = { width: 1.5, depth: 1.5, height: 0.3 }
  const enclosureHeight = 0.9
  
  return (
    <group position={[standX, 0, standZ]}>
      <mesh position={[0, platformSize.height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[platformSize.width, platformSize.height, platformSize.depth]} />
        <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
      </mesh>
      <mesh position={[0, platformSize.height + enclosureHeight / 2, platformSize.depth / 2 - 0.04]} castShadow>
        <boxGeometry args={[platformSize.width - 0.1, enclosureHeight, 0.08]} />
        <meshStandardMaterial color={COLORS.woodMedium} roughness={0.6} />
      </mesh>
      <mesh position={[-platformSize.width / 2 + 0.04, platformSize.height + enclosureHeight / 2, 0]} castShadow>
        <boxGeometry args={[0.08, enclosureHeight, platformSize.depth - 0.2]} />
        <meshStandardMaterial color={COLORS.woodMedium} roughness={0.6} />
      </mesh>
      <mesh position={[platformSize.width / 2 - 0.04, platformSize.height + enclosureHeight / 2, 0]} castShadow>
        <boxGeometry args={[0.08, enclosureHeight, platformSize.depth - 0.2]} />
        <meshStandardMaterial color={COLORS.woodMedium} roughness={0.6} />
      </mesh>
      <mesh position={[0, platformSize.height + enclosureHeight + 0.03, platformSize.depth / 2 - 0.04]} castShadow>
        <boxGeometry args={[platformSize.width, 0.06, 0.12]} />
        <meshStandardMaterial color={COLORS.woodAccent} roughness={0.5} metalness={0.1} />
      </mesh>
      <group position={[0, platformSize.height, -0.15]}>
        <mesh position={[0, 0.22, 0]} castShadow>
          <boxGeometry args={[0.45, 0.06, 0.4]} />
          <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.5, -0.17]} castShadow>
          <boxGeometry args={[0.45, 0.5, 0.05]} />
          <meshStandardMaterial color={COLORS.fabricBlue} roughness={0.9} />
        </mesh>
      </group>
      <Text position={[0, platformSize.height + enclosureHeight + 0.3, platformSize.depth / 2]} fontSize={0.1} color="#5c4d3d" anchorX="center">
        WITNESS
      </Text>
    </group>
  )
})

// --- JURY BOX ---
const JuryBox = memo(function JuryBox() {
  const boxX = 7
  const boxZ = -1
  const platformSize = { width: 4.5, depth: 3.5, height: 0.25 }
  const railHeight = 1
  const juryRows = 2
  const seatsPerRow = 6
  
  return (
    <group position={[boxX, 0, boxZ]}>
      <mesh position={[0, platformSize.height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[platformSize.width, platformSize.height, platformSize.depth]} />
        <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
      </mesh>
      <mesh position={[0, platformSize.height + railHeight / 2, platformSize.depth / 2 - 0.04]} castShadow>
        <boxGeometry args={[platformSize.width - 0.2, railHeight - 0.1, 0.08]} />
        <meshStandardMaterial color={COLORS.woodMedium} roughness={0.6} />
      </mesh>
      <mesh position={[0, platformSize.height + railHeight, platformSize.depth / 2 - 0.04]} castShadow>
        <boxGeometry args={[platformSize.width, 0.08, 0.15]} />
        <meshStandardMaterial color={COLORS.woodAccent} roughness={0.5} />
      </mesh>
      <mesh position={[-platformSize.width / 2 + 0.04, platformSize.height + railHeight / 2, 0]} castShadow>
        <boxGeometry args={[0.08, railHeight - 0.1, platformSize.depth - 0.2]} />
        <meshStandardMaterial color={COLORS.woodMedium} roughness={0.6} />
      </mesh>
      {Array.from({ length: juryRows }).map((_, row) => {
        const rowZ = (row - 0.5) * 1.2
        const rowY = platformSize.height + (row * 0.15)
        return Array.from({ length: seatsPerRow }).map((_, seat) => {
          const seatX = (seat - (seatsPerRow - 1) / 2) * 0.65
          return (
            <group key={`jury-${row}-${seat}`} position={[seatX, rowY, rowZ]}>
              <mesh position={[0, 0.22, 0]} castShadow>
                <boxGeometry args={[0.35, 0.05, 0.3]} />
                <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
              </mesh>
              <mesh position={[0, 0.42, -0.12]} castShadow>
                <boxGeometry args={[0.35, 0.35, 0.04]} />
                <meshStandardMaterial color={COLORS.fabricBlue} roughness={0.9} />
              </mesh>
            </group>
          )
        })
      })}
      <Text position={[0, platformSize.height + railHeight + 0.3, platformSize.depth / 2]} fontSize={0.12} color="#5c4d3d" anchorX="center">
        JURY
      </Text>
    </group>
  )
})

// --- GALLERY SEATING ---
const GallerySeating = memo(function GallerySeating() {
  const barZ = LAYOUT.barDivider
  const barWidth = 10
  const barHeight = 1
  const benchWidth = 8
  const benchRows = 3
  const firstRowZ = LAYOUT.galleryStart + 0.5
  const rowSpacing = LAYOUT.gallerySpacing
  
  return (
    <group>
      {/* Bar Divider */}
      <mesh position={[0, barHeight, barZ]} castShadow>
        <boxGeometry args={[barWidth, 0.1, 0.15]} />
        <meshStandardMaterial color={COLORS.woodAccent} roughness={0.5} metalness={0.1} />
      </mesh>
      <mesh position={[0, barHeight / 2, barZ]} castShadow>
        <boxGeometry args={[barWidth, barHeight - 0.1, 0.08]} />
        <meshStandardMaterial color={COLORS.woodMedium} roughness={0.6} />
      </mesh>
      <mesh position={[0, barHeight / 2, barZ + 0.05]} castShadow>
        <boxGeometry args={[barWidth - 1, barHeight - 0.3, 0.02]} />
        <meshStandardMaterial color={COLORS.woodLight} roughness={0.5} />
      </mesh>
      {[-4, -2, 0, 2, 4].map((x, i) => (
        <mesh key={`post-${i}`} position={[x, barHeight / 2, barZ]} castShadow>
          <cylinderGeometry args={[0.03, 0.03, barHeight, 16]} />
          <meshStandardMaterial color={COLORS.brass} roughness={0.3} metalness={0.7} />
        </mesh>
      ))}
      <mesh position={[0, barHeight / 2 - 0.1, barZ + 0.12]} castShadow>
        <boxGeometry args={[1.2, barHeight - 0.3, 0.04]} />
        <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
      </mesh>
      
      {/* Gallery Benches */}
      {Array.from({ length: benchRows }).map((_, row) => {
        const rowZ = firstRowZ + (row * rowSpacing)
        return (
          <group key={`gallery-row-${row}`} position={[0, 0, rowZ]} rotation={[0, Math.PI, 0]}>
            <mesh position={[0, 0.42, 0]} castShadow receiveShadow>
              <boxGeometry args={[benchWidth, 0.08, 0.5]} />
              <meshStandardMaterial color={COLORS.woodMedium} roughness={0.6} />
            </mesh>
            <mesh position={[0, 0.75, -0.22]} castShadow>
              <boxGeometry args={[benchWidth, 0.55, 0.06]} />
              <meshStandardMaterial color={COLORS.woodMedium} roughness={0.6} />
            </mesh>
            {[-benchWidth/2 + 0.15, 0, benchWidth/2 - 0.15].map((x, i) => (
              <mesh key={`support-${row}-${i}`} position={[x, 0.2, 0]} castShadow>
                <boxGeometry args={[0.1, 0.4, 0.45]} />
                <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
              </mesh>
            ))}
          </group>
        )
      })}
      
      {/* Entrance Door */}
      <group position={[0, 0, ROOM.backWall - 0.3]}>
        <mesh position={[0, 1.3, 0]} castShadow>
          <boxGeometry args={[2.4, 2.6, 0.08]} />
          <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
        </mesh>
        <mesh position={[-0.55, 1.25, 0.05]} castShadow>
          <boxGeometry args={[1.0, 2.4, 0.06]} />
          <meshStandardMaterial color={COLORS.woodMedium} roughness={0.5} />
        </mesh>
        <mesh position={[0.55, 1.25, 0.05]} castShadow>
          <boxGeometry args={[1.0, 2.4, 0.06]} />
          <meshStandardMaterial color={COLORS.woodMedium} roughness={0.5} />
        </mesh>
        {[1.7, 0.7].map((y, i) => (
          <mesh key={`lpanel-${i}`} position={[-0.55, y, 0.09]} castShadow>
            <boxGeometry args={[0.7, 0.6, 0.02]} />
            <meshStandardMaterial color={COLORS.woodLight} roughness={0.4} />
          </mesh>
        ))}
        {[1.7, 0.7].map((y, i) => (
          <mesh key={`rpanel-${i}`} position={[0.55, y, 0.09]} castShadow>
            <boxGeometry args={[0.7, 0.6, 0.02]} />
            <meshStandardMaterial color={COLORS.woodLight} roughness={0.4} />
          </mesh>
        ))}
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
const CounselDesk = memo(function CounselDesk({ position, label, chairOffset = 0.65 }: { position: [number, number, number], label: string, chairOffset?: number }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.75, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.8, 0.08, 0.8]} />
        <meshStandardMaterial color={COLORS.woodLight} roughness={0.4} metalness={0.05} />
      </mesh>
      <mesh position={[0, 0.4, -0.36]} castShadow receiveShadow>
        <boxGeometry args={[1.7, 0.7, 0.06]} />
        <meshStandardMaterial color={COLORS.woodMedium} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.4, -0.39]} castShadow>
        <boxGeometry args={[1.5, 0.55, 0.02]} />
        <meshStandardMaterial color={COLORS.woodLight} roughness={0.5} />
      </mesh>
      {[[-0.8, -0.3], [-0.8, 0.3], [0.8, -0.3], [0.8, 0.3]].map(([x, z], i) => (
        <mesh key={`leg-${i}`} position={[x, COURTROOM_CONFIG.counselTables.tableTopY / 2, z]} castShadow>
          <boxGeometry args={[0.08, COURTROOM_CONFIG.counselTables.tableTopY, 0.08]} />
          <meshStandardMaterial color={COLORS.woodDark} roughness={0.6} />
        </mesh>
      ))}
      
      {/* Chair */}
      <group position={[0, 0, chairOffset]}>
        <mesh position={[0, 0.45, 0]} castShadow>
          <boxGeometry args={[0.6, 0.1, 0.5]} />
          <meshStandardMaterial color={COLORS.fabricLeather} roughness={0.7} />
        </mesh>
        <mesh position={[0, 0.51, 0]} castShadow>
          <boxGeometry args={[0.55, 0.06, 0.45]} />
          <meshStandardMaterial color={COLORS.fabricLeather} roughness={0.4} metalness={0.1} />
        </mesh>
        <mesh position={[0, 0.95, 0.22]} castShadow>
          <boxGeometry args={[0.6, 0.9, 0.08]} />
          <meshStandardMaterial color={COLORS.fabricLeather} roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.95, 0.17]} castShadow>
          <boxGeometry args={[0.5, 0.75, 0.06]} />
          <meshStandardMaterial color={COLORS.fabricLeather} roughness={0.4} metalness={0.1} />
        </mesh>
        {[-0.15, 0, 0.15].map((x, i) => (
          <mesh key={`stitch-${i}`} position={[x, 0.95, 0.19]} castShadow>
            <boxGeometry args={[0.03, 0.7, 0.02]} />
            <meshStandardMaterial color={COLORS.fabricLeather} roughness={0.5} />
          </mesh>
        ))}
        {[-0.35, 0.35].map((x, i) => (
          <group key={`arm-${i}`} position={[x, 0.65, 0]}>
            <mesh position={[0, 0, 0]} castShadow>
              <boxGeometry args={[0.1, 0.06, 0.4]} />
              <meshStandardMaterial color={COLORS.fabricLeather} roughness={0.4} metalness={0.1} />
            </mesh>
            <mesh position={[0, -0.15, 0.15]} castShadow>
              <boxGeometry args={[0.06, 0.3, 0.06]} />
              <meshStandardMaterial color={COLORS.fabricLeather} roughness={0.6} />
            </mesh>
          </group>
        ))}
        <mesh position={[0, 1.35, 0.2]} castShadow>
          <boxGeometry args={[0.4, 0.15, 0.08]} />
          <meshStandardMaterial color={COLORS.fabricLeather} roughness={0.4} metalness={0.1} />
        </mesh>
        <mesh position={[0, 0.175, 0]} castShadow>
          <cylinderGeometry args={[0.05, 0.05, 0.35, 8]} />
          <meshStandardMaterial color="#1a1a1a" roughness={0.3} metalness={0.7} />
        </mesh>
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
      
      <mesh position={[0, 0.8, -0.42]} castShadow>
        <boxGeometry args={[0.5, 0.08, 0.04]} />
        <meshStandardMaterial color={COLORS.brass} roughness={0.3} metalness={0.6} />
      </mesh>
      <Text position={[0, 1.1, -0.4]} fontSize={0.1} color="#5c4d3d" anchorX="center" anchorY="middle">
        {label}
      </Text>
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
      <AmericanFlag />
      <StateFlag />
      <CourtSeal />
      <WitnessStand />
      <JuryBox />
      <CounselDesk 
        position={[defenseTableX, 0, counselTableZ]} 
        label="DEFENSE" 
        chairOffset={COURTROOM_CONFIG.counselTables.defenseChairZOffset} 
      />
      <CounselDesk position={[plaintiffTableX, 0, counselTableZ]} label="PLAINTIFF" />
      <GallerySeating />
    </group>
  )
})
