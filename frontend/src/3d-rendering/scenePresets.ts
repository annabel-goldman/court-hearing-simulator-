// ============================================================================
// SCENE CONFIGURATION PRESETS
// ============================================================================
// 
// This file contains all saved 3D scene configurations for the courtroom.
// Each preset is a complete snapshot that can be easily swapped.
//
// TO ADD A NEW PRESET:
//   1. Copy an existing preset object (e.g., spread from DEFAULT)
//   2. Give it a unique key (e.g., 'closeUp', 'wideShot')
//   3. Modify the values you want to change
//   4. Export it below
//
// TO SWITCH PRESETS:
//   In CourtroomPage.tsx, change: const SCENE_CONFIG = SCENE_PRESETS.yourPresetName
//
// COORDINATE SYSTEM:
//   X axis: Left (-) to Right (+), viewer facing judge
//   Y axis: Floor (0) to Ceiling (positive)
//   Z axis: Judge/Front (negative) to Gallery/Back (positive)
//
// ============================================================================

export interface AvatarPoseConfig {
  hipTiltX: number
  hipOffsetY: number
  thighRotationX: number
  calfRotationX: number
  footRotationX: number
  spineLeanX: number
}

export interface AvatarConfig {
  offsetX: number
  offsetY: number
  offsetZ: number
  rotationY: number
  pose: AvatarPoseConfig
}

export interface SceneConfig {
  // Preset metadata
  name: string
  description: string
  
  // Scene settings
  sceneScale: number
  
  avatars: {
    scale: number
    judge: AvatarConfig
    counsel: AvatarConfig
  }
  
  room: {
    width: number
    height: number
    length: number
    wallThickness: number
    frontWall: number
    backWall: number
    leftWall: number
    rightWall: number
    panelingHeight: number
  }
  
  layout: {
    judgeBench: number
    witnessStand: number
    counselTables: number
    barDivider: number
    galleryStart: number
    gallerySpacing: number
  }
  
  judgeBench: {
    tiers: {
      tier1: { width: number; depth: number; height: number }
      tier2: { width: number; depth: number; height: number }
      tier3: { width: number; depth: number; height: number }
    }
    desk: {
      width: number
      depth: number
      height: number
      zOffset: number
      frontPanelDepth: number
      chairOpeningWidth: number
    }
    chair: {
      zOffset: number
      seatHeight: number
    }
  }
  
  counselTables: {
    defenseX: number
    plaintiffX: number
    tableZ: number
    tableTopY: number
    chairSeatHeight: number
    chairZOffset: number
    defenseChairZOffset: number
  }
  
  colors: {
    woodDark: string
    woodMedium: string
    woodLight: string
    woodAccent: string
    marbleCream: string
    marbleGray: string
    brass: string
    fabricRed: string
    fabricBlue: string
    fabricLeather: string
    wallPaint: string
    ceiling: string
  }
  
  camera: {
    position: [number, number, number]
    fov: number
    minPolarAngle: number
    maxPolarAngle: number
    minAzimuthAngle: number
    maxAzimuthAngle: number
    rotateSpeed: number
  }
}

// ============================================================================
// DEFAULT PRESET - The original courtroom configuration
// ============================================================================
// This is the baseline configuration. Other presets can spread from this
// and override specific values.

const DEFAULT_POSE: AvatarPoseConfig = {
  hipTiltX: 0.15,
  hipOffsetY: 1.30,
  thighRotationX: Math.PI / 2,
  calfRotationX: Math.PI / 2,
  footRotationX: 0,
  spineLeanX: -0.05,
}

export const PRESET_DEFAULT: SceneConfig = {
  name: 'Default Courtroom',
  description: 'Standard courtroom view from defense table perspective',
  
  sceneScale: 0.55,
  
  avatars: {
    scale: 1.7,
    judge: {
      offsetX: 0,
      offsetY: -0.2,
      offsetZ: 0,
      rotationY: 0,
      pose: { ...DEFAULT_POSE },
    },
    counsel: {
      offsetX: 0,
      offsetY: -0.15,
      offsetZ: 0,
      rotationY: 180,
      pose: { ...DEFAULT_POSE },
    },
  },
  
  room: {
    width: 24,
    height: 6,
    length: 16,
    wallThickness: 0.3,
    frontWall: -6,
    backWall: 10,
    leftWall: -12,
    rightWall: 12,
    panelingHeight: 3,
  },
  
  layout: {
    judgeBench: -4,
    witnessStand: -2.5,
    counselTables: 0,
    barDivider: 3,
    galleryStart: 4,
    gallerySpacing: 2,
  },
  
  judgeBench: {
    tiers: {
      tier1: { width: 10, depth: 5, height: 0.2 },
      tier2: { width: 9, depth: 4, height: 0.2 },
      tier3: { width: 8, depth: 3, height: 0.2 },
    },
    desk: {
      width: 7,
      depth: 2,
      height: 1.2,
      zOffset: 1,
      frontPanelDepth: 0.3,
      chairOpeningWidth: 1.4,
    },
    chair: {
      zOffset: -1.2,
      seatHeight: 0.9,
    },
  },
  
  counselTables: {
    defenseX: -2.5,
    plaintiffX: 2.5,
    tableZ: 1,
    tableTopY: 0.75,
    chairSeatHeight: 0.45,
    chairZOffset: 1.0,
    defenseChairZOffset: 1.2,
  },
  
  colors: {
    woodDark: "#1a0f08",
    woodMedium: "#3d2817",
    woodLight: "#5c3d24",
    woodAccent: "#8B4513",
    marbleCream: "#f5f0e6",
    marbleGray: "#d4cfc5",
    brass: "#b5a642",
    fabricRed: "#8b1a1a",
    fabricBlue: "#1a3a5c",
    fabricLeather: "#3d2415",
    wallPaint: "#e8e4dc",
    ceiling: "#f5f5f0",
  },
  
  camera: {
    position: [-1.2, 1.6, 1.4],
    fov: 65,
    minPolarAngle: Math.PI / 3,
    maxPolarAngle: Math.PI / 1.7,
    minAzimuthAngle: -Infinity,
    maxAzimuthAngle: Infinity,
    rotateSpeed: 0.5,
  },
}

// ============================================================================
// PRESET COLLECTION - Export all presets for easy access
// ============================================================================

export const SCENE_PRESETS = {
  default: PRESET_DEFAULT,
} as const

export type PresetName = keyof typeof SCENE_PRESETS

// Default export for convenience
export default SCENE_PRESETS
