import { getAssetUrl } from '../config/assetUrls'
import type { JudgeAvatarDifficulty } from './types'

const chairUrl = getAssetUrl('3d-rendering/glb/Chair.glb')
const flagUrl = getAssetUrl('3d-rendering/glb/Flag.glb')
const lawyerDeskUrl = getAssetUrl('3d-rendering/glb/Lawyer Desk.glb')
const pewUrl = getAssetUrl('3d-rendering/glb/Pew.glb')
const emblemUrl = getAssetUrl('3d-rendering/glb/emblem.glb')
const windowUrl = getAssetUrl('3d-rendering/glb/Window.glb')
const beamUrl = getAssetUrl('3d-rendering/glb/beam.glb')
const easyJudgeClapUrl = getAssetUrl('3d-rendering/glb/Easy Judge/Meshy_AI_Animation_Sitting_Clap_withSkin.glb')
const easyJudgeRunUrl = getAssetUrl('3d-rendering/glb/Easy Judge/Meshy_AI_Animation_Running_withSkin.glb')
const easyJudgeSeatedAnsweringUrl = getAssetUrl('3d-rendering/glb/Easy Judge/Meshy_AI_Animation_Sitting_Answering_Questions_withSkin.glb')
const easyJudgeSitCheerUrl = getAssetUrl('3d-rendering/glb/Easy Judge/Meshy_AI_Animation_Sit_Cheer_with_Left_Hand_withSkin.glb')
const easyJudgeFingerWagUrl = getAssetUrl('3d-rendering/glb/Easy Judge/Meshy_AI_Animation_Sit_Finger_Wag_No_withSkin.glb')
const easyJudgeWalkUrl = getAssetUrl('3d-rendering/glb/Easy Judge/Meshy_AI_Animation_Walking_withSkin.glb')
const mediumJudgeClapUrl = getAssetUrl('3d-rendering/glb/Medium Judge/Meshy_AI_Animation_Sitting_Clap_withSkin.glb')
const mediumJudgeRunUrl = getAssetUrl('3d-rendering/glb/Medium Judge/Meshy_AI_Animation_Running_withSkin.glb')
const mediumJudgeSeatedAnsweringUrl = getAssetUrl('3d-rendering/glb/Medium Judge/Meshy_AI_Animation_Sitting_Answering_Questions_withSkin.glb')
const mediumJudgeSeatedFistPumpUrl = getAssetUrl('3d-rendering/glb/Medium Judge/Meshy_AI_Animation_Seated_Fist_Pump_withSkin.glb')
const mediumJudgeFingerWagUrl = getAssetUrl('3d-rendering/glb/Medium Judge/Meshy_AI_Animation_Sit_Finger_Wag_No_withSkin.glb')
const mediumJudgeWalkUrl = getAssetUrl('3d-rendering/glb/Medium Judge/Meshy_AI_Animation_Walking_withSkin.glb')
const hardJudgeClapUrl = getAssetUrl('3d-rendering/glb/Hard Judge/Meshy_AI_Animation_Sitting_Clap_withSkin.glb')
const hardJudgeRunUrl = getAssetUrl('3d-rendering/glb/Hard Judge/Meshy_AI_Animation_Running_withSkin.glb')
const hardJudgeSeatedAnsweringUrl = getAssetUrl('3d-rendering/glb/Hard Judge/Meshy_AI_Animation_Sitting_Answering_Questions_withSkin.glb')
const hardJudgeSitCheerUrl = getAssetUrl('3d-rendering/glb/Hard Judge/Meshy_AI_Animation_Sit_Cheer_with_Left_Hand_withSkin.glb')
const hardJudgeSitTransitionUrl = getAssetUrl('3d-rendering/glb/Hard Judge/Meshy_AI_Animation_Step_to_Sit_Transition_withSkin.glb')
const hardJudgeWalkUrl = getAssetUrl('3d-rendering/glb/Hard Judge/Meshy_AI_Animation_Walking_withSkin.glb')
const counselClapUrl = getAssetUrl('3d-rendering/glb/Opposing Council/Meshy_AI_Animation_Sitting_Clap_withSkin.glb')
const counselRunUrl = getAssetUrl('3d-rendering/glb/Opposing Council/Meshy_AI_Animation_Running_withSkin.glb')
const counselSeatedAnsweringUrl = getAssetUrl('3d-rendering/glb/Opposing Council/Meshy_AI_Animation_Sitting_Answering_Questions_withSkin.glb')
const counselSitCheerUrl = getAssetUrl('3d-rendering/glb/Opposing Council/Meshy_AI_Animation_Sit_Cheer_with_Left_Hand_withSkin.glb')
const counselSitDozeUrl = getAssetUrl('3d-rendering/glb/Opposing Council/Meshy_AI_Animation_Sit_and_Doze_Off_withSkin.glb')
const counselSitToStandUrl = getAssetUrl('3d-rendering/glb/Opposing Council/Meshy_AI_Animation_Sit_to_Stand_Transition_M_withSkin.glb')
const counselWalkUrl = getAssetUrl('3d-rendering/glb/Opposing Council/Meshy_AI_Animation_Walking_withSkin.glb')

// ============================================================================
// EDITABLE NUMERIC CONTROLS (PRIMARY EDIT ZONE)
// ============================================================================
// If you want to tune scene layout/scale/pose values, edit numbers in this block.
// Non-numeric wiring (URLs, booleans, ids, labels) is intentionally kept below.

export const EDITABLE_NUMERIC_CONTROLS = {
  scene: {
    scale: 0.55,
  },

  room: {
    width: 12,
    height: 5.2,
    length: 16,
    wallThickness: 0.3,
    frontWall: -5,
    backWall: 8,
    leftWall: -6,
    rightWall: 6,
    panelingHeight: 3,
  },

  layout: {
    judgeBenchZ: -3.6,
    counselTablesZ: 0,
    barDividerZ: 2.2,
    galleryStartZ: 3.1,
    gallerySpacing: 2.05,
  },

  judgeBench: {
    tier1: {
      width: 8.2,
      depth: 3.0,
      height: 0.35,
    },
    // Moves the entire judge bench assembly (step + desk + chair).
    positionOffset: [0, 0, 0] as [number, number, number],
    // Pulls/pushes the step relative to the bench anchor on Z.
    stepFrontInset: 0.5,
    deskZOffset: 1,
  },

  furniture: {
    judgeDesk: {
      scale: 3,
      positionOffset: [0, 0.01, 0] as [number, number, number],
      rotation: [0, Math.PI, 0] as [number, number, number],
    },
    lawyerDesk: {
      scale: 3.3,
      positionOffset: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      location: {
        mainLawyerX: -2.1,
        opposingCounselX: 2.1,
        z: 0.65,
      },
    },
    chair: {
      scale: 1.7,
      positionOffset: [0, 0, 0.4] as [number, number, number],
      rotation: [0, Math.PI, 0] as [number, number, number],
      location: {
        judge: {
          zOffset: -1.2,
          seatHeight: 0.9,
          // Rotate judge chair independently from counsel chairs.
          rotationYOffset: Math.PI,
        },
        counselRow: {
          seatHeight: 0.45,
          mainLawyerChairZOffset: 0.95,
          opposingCounselChairZOffset: 0.8,
        },
      },
    },
    flag: {
      scale: 4,
      // For the flag, Z is treated as offset from front wall.
      positionOffset: [-3, 0.25, 1.3] as [number, number, number],
      rotation: [0, Math.PI, 0] as [number, number, number],
    },
    pew: {
      scale: 7.6,
      positionOffset: [0, 0.02, 0] as [number, number, number],
      rotation: [0, Math.PI, 0] as [number, number, number],
    },
    emblem: {
      scale: 2,
      // For the emblem, Z is treated as offset from front wall.
      positionOffset: [0, 2.25, 0.22] as [number, number, number],
      rotation: [0, Math.PI, 0] as [number, number, number],
    },
    window: {
      scale: 5.4,
      // For side-wall windows, Y is sill height and Z is additional inset past wall face.
      positionOffset: [0, -0.2, 0.1] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      skyBackdrop: {
        // Negative values move the sky pane slightly inside the room.
        xOffsetFromWall: -0.1,
        // Offset from window baseline and centerline.
        yOffset: 0,
        zOffset: 0,
        // Scale relative to computed window bounds.
        widthScale: 0.8,
        heightScale: 0.98,
      },
    },
    beam: {
      // For the beam, Z is treated as offset from front wall.
      scale: 12.4,
      positionOffset: [0, 4.5, 0.4] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
    },
  },

  avatars: {
    common: {
      baseScale: 2,
      baseScaleMultiplier: 0.64,
      globalScaleMultiplier: 1.14,
    },

    judge: {
      // Placement in the room.
      placement: {
        offsetX: 0,
        offsetY: -0.9,
        offsetZ: 1.7,
        rotationY: 0,
      },
      // Movement/render tuning separate from bone pose.
      motion: {
        // Keep this at 1 to have common.baseScale affect both avatars equally.
        scaleMultiplier: 1,
        positionOffset: [0, 0, 0.16] as [number, number, number],
        rotationOffsetY: 0,
        frozenPoseTime: 999,
        animationSpeed: 1,
      },
      // Bone pose tuning (avatar-relative).
      bodyPose: {
        hipTiltX: 0.14,
        hipOffsetY: 1.3,
        thighRotationX: Math.PI / 2,
        calfRotationX: Math.PI / 2,
        footRotationX: 0,
        spineLeanX: -0.04,
        leftUpperArmRotationZ: -150,
        rightUpperArmRotationZ: 200,
        leftElbowRotationX: 0.25,
        rightElbowRotationX: 0.25,
        leftElbowRotationZ: 0,
        rightElbowRotationZ: 0,
      },
    },

    counsel: {
      // Placement in the room.
      placement: {
        offsetX: 0,
        offsetY: -0.48,
        offsetZ: -0.3,
        rotationY: 180,
      },
      // Movement/render tuning separate from bone pose.
      motion: {
        scaleMultiplier: 1,
        positionOffset: [0, 0, 0] as [number, number, number],
        rotationOffsetY: 0,
        frozenPoseTime: 1.1,
        animationSpeed: 1,
      },
      // Bone pose tuning (avatar-relative).
      bodyPose: {
        hipTiltX: 0.14,
        hipOffsetY: 1.3,
        thighRotationX: Math.PI / 2,
        calfRotationX: Math.PI / 2,
        footRotationX: 0,
        spineLeanX: -0.04,
        leftUpperArmRotationZ: 1.8,
        rightUpperArmRotationZ: -1,
        leftElbowRotationX: 0.25,
        rightElbowRotationX: 0.25,
        leftElbowRotationZ: 0,
        rightElbowRotationZ: 0,
      },
    },
  },

  camera: {
    // Primary POV preset: edit these values to control startup camera framing.
    position: [-1.2, 1.45, 1.2] as [number, number, number],
    // Orbit pivot point (what the camera rotates around).
    target: [-1.28, 1.5, 1.25] as [number, number, number],
    // Startup facing offsets in radians. These rotate the initial view while keeping
    // target/pivot fixed.
    orbitYawOffset: -9,
    orbitPitchOffset: -0.5,
    fov: 65,
    minPolarAngle: Math.PI / 3,
    maxPolarAngle: Math.PI / 1.7,
    minAzimuthAngle: -Infinity,
    maxAzimuthAngle: Infinity,
    rotateSpeed: 0.5,
  },
}

// ============================================================================
// SCENE PRESET TYPES
// ============================================================================

export interface AvatarPoseConfig {
  hipTiltX: number
  hipOffsetY: number
  thighRotationX: number
  calfRotationX: number
  footRotationX: number
  spineLeanX: number
  leftUpperArmRotationZ: number
  rightUpperArmRotationZ: number
  leftElbowRotationX: number
  rightElbowRotationX: number
  leftElbowRotationZ: number
  rightElbowRotationZ: number
}

export interface AvatarConfig {
  offsetX: number
  offsetY: number
  offsetZ: number
  rotationY: number
  pose: AvatarPoseConfig
}

export interface SceneConfig {
  name: string
  description: string
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
    counselTables: number
    barDivider: number
    galleryStart: number
    gallerySpacing: number
  }
  judgeBench: {
    tiers: {
      tier1: { width: number; depth: number; height: number }
    }
    positionOffset: [number, number, number]
    stepFrontInset: number
    desk: {
      zOffset: number
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
    target: [number, number, number]
    orbitYawOffset: number
    orbitPitchOffset: number
    fov: number
    minPolarAngle: number
    maxPolarAngle: number
    minAzimuthAngle: number
    maxAzimuthAngle: number
    rotateSpeed: number
  }
}

// ============================================================================
// GLB + AVATAR RUNTIME TYPES
// ============================================================================

export type AvatarRole = 'judge' | 'counsel'

export interface GlbPlacementConfig {
  url: string
  scale: number
  positionOffset: [number, number, number]
  rotation: [number, number, number]
}

export interface AvatarAnimationAssignment {
  enabled: boolean
  assetId: string
  loop: boolean
  speed: number
  clipName?: string
  overrideSitting?: boolean
  overrideStationary?: boolean
}

export interface AvatarFrozenPoseAssignment {
  enabled: boolean
  assetId: string
  time: number
  clipName?: string
}

export interface AvatarRuntimeConfig {
  defaultAssetId: string
  scaleMultiplier: number
  positionOffset: [number, number, number]
  rotationOffsetY: number
  sitting: boolean
  stationary: boolean
  poseOverride: Partial<AvatarPoseConfig>
  frozenPose: AvatarFrozenPoseAssignment
  animation: AvatarAnimationAssignment
}

// ============================================================================
// NON-NUMERIC WIRING (USUALLY DO NOT EDIT)
// ============================================================================

const NON_NUMERIC_PRESET_METADATA = {
  name: 'Default Courtroom',
  description: 'Standard courtroom view from defense table perspective',
} as const

const NON_NUMERIC_COLORS = {
  woodDark: '#1a0f08',
  woodMedium: '#3d2817',
  woodLight: '#5c3d24',
  woodAccent: '#8B4513',
  marbleCream: '#f5f0e6',
  marbleGray: '#d4cfc5',
  brass: '#b5a642',
  fabricRed: '#8b1a1a',
  fabricBlue: '#1a3a5c',
  fabricLeather: '#3d2415',
  wallPaint: '#f5cea4',
  ceiling: '#804a00',
} as const

const NON_NUMERIC_JUDGE_AVATAR_ASSETS_BY_DIFFICULTY: Record<JudgeAvatarDifficulty, Record<string, string>> = {
  easy: {
    seatedAnswering: easyJudgeSeatedAnsweringUrl,
    walking: easyJudgeWalkUrl,
    running: easyJudgeRunUrl,
    sitTransition: easyJudgeSeatedAnsweringUrl,
    sitCheer: easyJudgeSitCheerUrl,
    clap: easyJudgeClapUrl,
    fingerWag: easyJudgeFingerWagUrl,
  },
  medium: {
    seatedAnswering: mediumJudgeSeatedAnsweringUrl,
    walking: mediumJudgeWalkUrl,
    running: mediumJudgeRunUrl,
    sitTransition: mediumJudgeSeatedAnsweringUrl,
    sitCheer: mediumJudgeSeatedFistPumpUrl,
    clap: mediumJudgeClapUrl,
    fingerWag: mediumJudgeFingerWagUrl,
    fistPump: mediumJudgeSeatedFistPumpUrl,
  },
  hard: {
    seatedAnswering: hardJudgeSeatedAnsweringUrl,
    walking: hardJudgeWalkUrl,
    running: hardJudgeRunUrl,
    sitTransition: hardJudgeSitTransitionUrl,
    sitCheer: hardJudgeSitCheerUrl,
    clap: hardJudgeClapUrl,
  },
} as const

const NON_NUMERIC_AVATAR_ASSETS: Record<AvatarRole, Record<string, string>> = {
  judge: NON_NUMERIC_JUDGE_AVATAR_ASSETS_BY_DIFFICULTY.medium,
  counsel: {
    seatedAnswering: counselSeatedAnsweringUrl,
    walking: counselWalkUrl,
    running: counselRunUrl,
    sitToStand: counselSitToStandUrl,
    sitDoze: counselSitDozeUrl,
    sitCheer: counselSitCheerUrl,
    clap: counselClapUrl,
  },
}

const NON_NUMERIC_AVATAR_RUNTIME = {
  judge: {
    defaultAssetId: 'seatedAnswering',
    sitting: true,
    stationary: true,
    poseOverride: {},
    frozenPose: {
      enabled: false,
      assetId: 'sitTransition',
      clipName: undefined,
    },
    animation: {
      enabled: false,
      assetId: 'walking',
      loop: true,
      clipName: undefined,
      overrideSitting: false,
      overrideStationary: false,
    },
  },
  counsel: {
    defaultAssetId: 'seatedAnswering',
    sitting: true,
    stationary: true,
    poseOverride: {},
    frozenPose: {
      enabled: false,
      assetId: 'seatedAnswering',
      clipName: undefined,
    },
    animation: {
      enabled: false,
      assetId: 'walking',
      loop: true,
      clipName: undefined,
      overrideSitting: false,
      overrideStationary: false,
    },
  },
} as const

// ============================================================================
// DERIVED EDITABLE EXPORTS
// ============================================================================

export const CHAIR_CONSTANTS = {
  glb: {
    url: chairUrl,
    scale: EDITABLE_NUMERIC_CONTROLS.furniture.chair.scale,
    positionOffset: EDITABLE_NUMERIC_CONTROLS.furniture.chair.positionOffset,
    rotation: EDITABLE_NUMERIC_CONTROLS.furniture.chair.rotation,
  },
  location: {
    judge: {
      zOffset: EDITABLE_NUMERIC_CONTROLS.furniture.chair.location.judge.zOffset,
      seatHeight: EDITABLE_NUMERIC_CONTROLS.furniture.chair.location.judge.seatHeight,
      rotationYOffset: EDITABLE_NUMERIC_CONTROLS.furniture.chair.location.judge.rotationYOffset,
    },
    counselRow: {
      seatHeight: EDITABLE_NUMERIC_CONTROLS.furniture.chair.location.counselRow.seatHeight,
      mainLawyerChairZOffset: EDITABLE_NUMERIC_CONTROLS.furniture.chair.location.counselRow.mainLawyerChairZOffset,
      opposingCounselChairZOffset: EDITABLE_NUMERIC_CONTROLS.furniture.chair.location.counselRow.opposingCounselChairZOffset,
    },
  },
} as const

export const LAWYER_DESK_CONSTANTS = {
  glb: {
    url: lawyerDeskUrl,
    scale: EDITABLE_NUMERIC_CONTROLS.furniture.lawyerDesk.scale,
    positionOffset: EDITABLE_NUMERIC_CONTROLS.furniture.lawyerDesk.positionOffset,
    rotation: EDITABLE_NUMERIC_CONTROLS.furniture.lawyerDesk.rotation,
  },
  location: {
    mainLawyerX: EDITABLE_NUMERIC_CONTROLS.furniture.lawyerDesk.location.mainLawyerX,
    opposingCounselX: EDITABLE_NUMERIC_CONTROLS.furniture.lawyerDesk.location.opposingCounselX,
    z: EDITABLE_NUMERIC_CONTROLS.furniture.lawyerDesk.location.z,
  },
} as const

export const JUDGE_DESK_CONSTANTS = {
  glb: {
    url: lawyerDeskUrl,
    scale: EDITABLE_NUMERIC_CONTROLS.furniture.judgeDesk.scale,
    positionOffset: EDITABLE_NUMERIC_CONTROLS.furniture.judgeDesk.positionOffset,
    rotation: EDITABLE_NUMERIC_CONTROLS.furniture.judgeDesk.rotation,
  },
  location: {
    benchZ: EDITABLE_NUMERIC_CONTROLS.layout.judgeBenchZ,
    deskZOffset: EDITABLE_NUMERIC_CONTROLS.judgeBench.deskZOffset,
  },
} as const

export const FLAG_CONSTANTS = {
  glb: {
    url: flagUrl,
    scale: EDITABLE_NUMERIC_CONTROLS.furniture.flag.scale,
    positionOffset: EDITABLE_NUMERIC_CONTROLS.furniture.flag.positionOffset,
    rotation: EDITABLE_NUMERIC_CONTROLS.furniture.flag.rotation,
  },
} as const

export const PEW_CONSTANTS = {
  glb: {
    url: pewUrl,
    scale: EDITABLE_NUMERIC_CONTROLS.furniture.pew.scale,
    positionOffset: EDITABLE_NUMERIC_CONTROLS.furniture.pew.positionOffset,
    rotation: EDITABLE_NUMERIC_CONTROLS.furniture.pew.rotation,
  },
} as const

export const EMBLEM_CONSTANTS = {
  glb: {
    url: emblemUrl,
    scale: EDITABLE_NUMERIC_CONTROLS.furniture.emblem.scale,
    positionOffset: EDITABLE_NUMERIC_CONTROLS.furniture.emblem.positionOffset,
    rotation: EDITABLE_NUMERIC_CONTROLS.furniture.emblem.rotation,
  },
} as const

export const WINDOW_CONSTANTS = {
  glb: {
    url: windowUrl,
    scale: EDITABLE_NUMERIC_CONTROLS.furniture.window.scale,
    positionOffset: EDITABLE_NUMERIC_CONTROLS.furniture.window.positionOffset,
    rotation: EDITABLE_NUMERIC_CONTROLS.furniture.window.rotation,
  },
} as const

export const BEAM_CONSTANTS = {
  glb: {
    url: beamUrl,
    scale: EDITABLE_NUMERIC_CONTROLS.furniture.beam.scale,
    positionOffset: EDITABLE_NUMERIC_CONTROLS.furniture.beam.positionOffset,
    rotation: EDITABLE_NUMERIC_CONTROLS.furniture.beam.rotation,
  },
} as const

export const WINDOW_SKY_BACKDROP_SETTINGS = {
  xOffsetFromWall: EDITABLE_NUMERIC_CONTROLS.furniture.window.skyBackdrop.xOffsetFromWall,
  yOffset: EDITABLE_NUMERIC_CONTROLS.furniture.window.skyBackdrop.yOffset,
  zOffset: EDITABLE_NUMERIC_CONTROLS.furniture.window.skyBackdrop.zOffset,
  widthScale: EDITABLE_NUMERIC_CONTROLS.furniture.window.skyBackdrop.widthScale,
  heightScale: EDITABLE_NUMERIC_CONTROLS.furniture.window.skyBackdrop.heightScale,
} as const

// ============================================================================
// DEFAULT AVATAR POSES (EDITABLE NUMERIC VALUES ARE ABOVE)
// ============================================================================

export const DEFAULT_JUDGE_POSE: AvatarPoseConfig = {
  // Tilts hips forward/backward relative to this avatar's base skeleton.
  hipTiltX: EDITABLE_NUMERIC_CONTROLS.avatars.judge.bodyPose.hipTiltX,
  // Raises/lowers hips relative to neutral seated baseline (1.3).
  hipOffsetY: EDITABLE_NUMERIC_CONTROLS.avatars.judge.bodyPose.hipOffsetY,
  // Upper leg bend at hips; larger values fold knees upward.
  thighRotationX: EDITABLE_NUMERIC_CONTROLS.avatars.judge.bodyPose.thighRotationX,
  // Lower leg bend; larger values tuck calves further back.
  calfRotationX: EDITABLE_NUMERIC_CONTROLS.avatars.judge.bodyPose.calfRotationX,
  // Foot pitch relative to calves.
  footRotationX: EDITABLE_NUMERIC_CONTROLS.avatars.judge.bodyPose.footRotationX,
  // Spine lean; negative leans back, positive leans forward.
  spineLeanX: EDITABLE_NUMERIC_CONTROLS.avatars.judge.bodyPose.spineLeanX,
  // Left upper arm spread/drop. Arms-down is often around +/-1.2 to +/-1.6.
  leftUpperArmRotationZ: EDITABLE_NUMERIC_CONTROLS.avatars.judge.bodyPose.leftUpperArmRotationZ,
  // Right upper arm counterpart, usually opposite sign to left.
  rightUpperArmRotationZ: EDITABLE_NUMERIC_CONTROLS.avatars.judge.bodyPose.rightUpperArmRotationZ,
  // Elbow bend axis; increase/decrease for tighter/looser bend.
  leftElbowRotationX: EDITABLE_NUMERIC_CONTROLS.avatars.judge.bodyPose.leftElbowRotationX,
  // Elbow bend axis; increase/decrease for tighter/looser bend.
  rightElbowRotationX: EDITABLE_NUMERIC_CONTROLS.avatars.judge.bodyPose.rightElbowRotationX,
  // Elbow flare/twist for left forearm.
  leftElbowRotationZ: EDITABLE_NUMERIC_CONTROLS.avatars.judge.bodyPose.leftElbowRotationZ,
  // Elbow flare/twist for right forearm.
  rightElbowRotationZ: EDITABLE_NUMERIC_CONTROLS.avatars.judge.bodyPose.rightElbowRotationZ,
}

export const DEFAULT_LAWYER_POSE: AvatarPoseConfig = {
  // Tilts hips forward/backward relative to this avatar's base skeleton.
  hipTiltX: EDITABLE_NUMERIC_CONTROLS.avatars.counsel.bodyPose.hipTiltX,
  // Raises/lowers hips relative to neutral seated baseline (1.3).
  hipOffsetY: EDITABLE_NUMERIC_CONTROLS.avatars.counsel.bodyPose.hipOffsetY,
  // Upper leg bend at hips; larger values fold knees upward.
  thighRotationX: EDITABLE_NUMERIC_CONTROLS.avatars.counsel.bodyPose.thighRotationX,
  // Lower leg bend; larger values tuck calves further back.
  calfRotationX: EDITABLE_NUMERIC_CONTROLS.avatars.counsel.bodyPose.calfRotationX,
  // Foot pitch relative to calves.
  footRotationX: EDITABLE_NUMERIC_CONTROLS.avatars.counsel.bodyPose.footRotationX,
  // Spine lean; negative leans back, positive leans forward.
  spineLeanX: EDITABLE_NUMERIC_CONTROLS.avatars.counsel.bodyPose.spineLeanX,
  // Left upper arm spread/drop. Arms-down is often around +/-1.2 to +/-1.6.
  leftUpperArmRotationZ: EDITABLE_NUMERIC_CONTROLS.avatars.counsel.bodyPose.leftUpperArmRotationZ,
  // Right upper arm counterpart, usually opposite sign to left.
  rightUpperArmRotationZ: EDITABLE_NUMERIC_CONTROLS.avatars.counsel.bodyPose.rightUpperArmRotationZ,
  // Elbow bend axis; increase/decrease for tighter/looser bend.
  leftElbowRotationX: EDITABLE_NUMERIC_CONTROLS.avatars.counsel.bodyPose.leftElbowRotationX,
  // Elbow bend axis; increase/decrease for tighter/looser bend.
  rightElbowRotationX: EDITABLE_NUMERIC_CONTROLS.avatars.counsel.bodyPose.rightElbowRotationX,
  // Elbow flare/twist for left forearm.
  leftElbowRotationZ: EDITABLE_NUMERIC_CONTROLS.avatars.counsel.bodyPose.leftElbowRotationZ,
  // Elbow flare/twist for right forearm.
  rightElbowRotationZ: EDITABLE_NUMERIC_CONTROLS.avatars.counsel.bodyPose.rightElbowRotationZ,
}

// ============================================================================
// SCENE PRESET DATA
// ============================================================================

export const PRESET_DEFAULT: SceneConfig = {
  name: NON_NUMERIC_PRESET_METADATA.name,
  description: NON_NUMERIC_PRESET_METADATA.description,
  sceneScale: EDITABLE_NUMERIC_CONTROLS.scene.scale,
  avatars: {
    scale: EDITABLE_NUMERIC_CONTROLS.avatars.common.baseScale,
    judge: {
      offsetX: EDITABLE_NUMERIC_CONTROLS.avatars.judge.placement.offsetX,
      offsetY: EDITABLE_NUMERIC_CONTROLS.avatars.judge.placement.offsetY,
      offsetZ: EDITABLE_NUMERIC_CONTROLS.avatars.judge.placement.offsetZ,
      rotationY: EDITABLE_NUMERIC_CONTROLS.avatars.judge.placement.rotationY,
      pose: { ...DEFAULT_JUDGE_POSE },
    },
    counsel: {
      offsetX: EDITABLE_NUMERIC_CONTROLS.avatars.counsel.placement.offsetX,
      offsetY: EDITABLE_NUMERIC_CONTROLS.avatars.counsel.placement.offsetY,
      offsetZ: EDITABLE_NUMERIC_CONTROLS.avatars.counsel.placement.offsetZ,
      rotationY: EDITABLE_NUMERIC_CONTROLS.avatars.counsel.placement.rotationY,
      pose: { ...DEFAULT_LAWYER_POSE },
    },
  },
  room: {
    width: EDITABLE_NUMERIC_CONTROLS.room.width,
    height: EDITABLE_NUMERIC_CONTROLS.room.height,
    length: EDITABLE_NUMERIC_CONTROLS.room.length,
    wallThickness: EDITABLE_NUMERIC_CONTROLS.room.wallThickness,
    frontWall: EDITABLE_NUMERIC_CONTROLS.room.frontWall,
    backWall: EDITABLE_NUMERIC_CONTROLS.room.backWall,
    leftWall: EDITABLE_NUMERIC_CONTROLS.room.leftWall,
    rightWall: EDITABLE_NUMERIC_CONTROLS.room.rightWall,
    panelingHeight: EDITABLE_NUMERIC_CONTROLS.room.panelingHeight,
  },
  layout: {
    judgeBench: EDITABLE_NUMERIC_CONTROLS.layout.judgeBenchZ,
    counselTables: EDITABLE_NUMERIC_CONTROLS.layout.counselTablesZ,
    barDivider: EDITABLE_NUMERIC_CONTROLS.layout.barDividerZ,
    galleryStart: EDITABLE_NUMERIC_CONTROLS.layout.galleryStartZ,
    gallerySpacing: EDITABLE_NUMERIC_CONTROLS.layout.gallerySpacing,
  },
  judgeBench: {
    tiers: {
      tier1: {
        width: EDITABLE_NUMERIC_CONTROLS.judgeBench.tier1.width,
        depth: EDITABLE_NUMERIC_CONTROLS.judgeBench.tier1.depth,
        height: EDITABLE_NUMERIC_CONTROLS.judgeBench.tier1.height,
      },
    },
    positionOffset: EDITABLE_NUMERIC_CONTROLS.judgeBench.positionOffset,
    stepFrontInset: EDITABLE_NUMERIC_CONTROLS.judgeBench.stepFrontInset,
    desk: {
      zOffset: EDITABLE_NUMERIC_CONTROLS.judgeBench.deskZOffset,
    },
    chair: {
      zOffset: EDITABLE_NUMERIC_CONTROLS.furniture.chair.location.judge.zOffset,
      seatHeight: EDITABLE_NUMERIC_CONTROLS.furniture.chair.location.judge.seatHeight,
    },
  },
  counselTables: {
    defenseX: EDITABLE_NUMERIC_CONTROLS.furniture.lawyerDesk.location.mainLawyerX,
    plaintiffX: EDITABLE_NUMERIC_CONTROLS.furniture.lawyerDesk.location.opposingCounselX,
    tableZ: EDITABLE_NUMERIC_CONTROLS.furniture.lawyerDesk.location.z,
    chairSeatHeight: EDITABLE_NUMERIC_CONTROLS.furniture.chair.location.counselRow.seatHeight,
    chairZOffset: EDITABLE_NUMERIC_CONTROLS.furniture.chair.location.counselRow.opposingCounselChairZOffset,
    defenseChairZOffset: EDITABLE_NUMERIC_CONTROLS.furniture.chair.location.counselRow.mainLawyerChairZOffset,
  },
  colors: {
    woodDark: NON_NUMERIC_COLORS.woodDark,
    woodMedium: NON_NUMERIC_COLORS.woodMedium,
    woodLight: NON_NUMERIC_COLORS.woodLight,
    woodAccent: NON_NUMERIC_COLORS.woodAccent,
    marbleCream: NON_NUMERIC_COLORS.marbleCream,
    marbleGray: NON_NUMERIC_COLORS.marbleGray,
    brass: NON_NUMERIC_COLORS.brass,
    fabricRed: NON_NUMERIC_COLORS.fabricRed,
    fabricBlue: NON_NUMERIC_COLORS.fabricBlue,
    fabricLeather: NON_NUMERIC_COLORS.fabricLeather,
    wallPaint: NON_NUMERIC_COLORS.wallPaint,
    ceiling: NON_NUMERIC_COLORS.ceiling,
  },
  camera: {
    position: EDITABLE_NUMERIC_CONTROLS.camera.position,
    target: EDITABLE_NUMERIC_CONTROLS.camera.target,
    orbitYawOffset: EDITABLE_NUMERIC_CONTROLS.camera.orbitYawOffset,
    orbitPitchOffset: EDITABLE_NUMERIC_CONTROLS.camera.orbitPitchOffset,
    fov: EDITABLE_NUMERIC_CONTROLS.camera.fov,
    minPolarAngle: EDITABLE_NUMERIC_CONTROLS.camera.minPolarAngle,
    maxPolarAngle: EDITABLE_NUMERIC_CONTROLS.camera.maxPolarAngle,
    minAzimuthAngle: EDITABLE_NUMERIC_CONTROLS.camera.minAzimuthAngle,
    maxAzimuthAngle: EDITABLE_NUMERIC_CONTROLS.camera.maxAzimuthAngle,
    rotateSpeed: EDITABLE_NUMERIC_CONTROLS.camera.rotateSpeed,
  },
}

export const SCENE_PRESETS = {
  default: PRESET_DEFAULT,
} as const

export type PresetName = keyof typeof SCENE_PRESETS

// ============================================================================
// GLB/FURNITURE SETTINGS
// ============================================================================

export const AVATAR_SCENE_SETTINGS = {
  baseScaleMultiplier: EDITABLE_NUMERIC_CONTROLS.avatars.common.baseScaleMultiplier,
  globalScaleMultiplier: EDITABLE_NUMERIC_CONTROLS.avatars.common.globalScaleMultiplier,
} as const

export const FURNITURE_GLB_SETTINGS = {
  judgeDesk: JUDGE_DESK_CONSTANTS.glb,
  lawyerDesk: LAWYER_DESK_CONSTANTS.glb,
  chair: CHAIR_CONSTANTS.glb,
  flag: FLAG_CONSTANTS.glb,
  pew: PEW_CONSTANTS.glb,
  emblem: EMBLEM_CONSTANTS.glb,
  window: WINDOW_CONSTANTS.glb,
  beam: BEAM_CONSTANTS.glb,
} as const satisfies Record<string, GlbPlacementConfig>

// ============================================================================
// AVATAR ASSET LIBRARY + RUNTIME SETTINGS
// ============================================================================

export const AVATAR_GLB_ASSETS: Record<AvatarRole, Record<string, string>> = {
  judge: NON_NUMERIC_AVATAR_ASSETS.judge,
  counsel: NON_NUMERIC_AVATAR_ASSETS.counsel,
}

export const JUDGE_AVATAR_ASSETS_BY_DIFFICULTY: Record<JudgeAvatarDifficulty, Record<string, string>> = {
  easy: NON_NUMERIC_JUDGE_AVATAR_ASSETS_BY_DIFFICULTY.easy,
  medium: NON_NUMERIC_JUDGE_AVATAR_ASSETS_BY_DIFFICULTY.medium,
  hard: NON_NUMERIC_JUDGE_AVATAR_ASSETS_BY_DIFFICULTY.hard,
}

export const AVATAR_RUNTIME_SETTINGS: Record<AvatarRole, AvatarRuntimeConfig> = {
  judge: {
    defaultAssetId: NON_NUMERIC_AVATAR_RUNTIME.judge.defaultAssetId,
    scaleMultiplier: EDITABLE_NUMERIC_CONTROLS.avatars.judge.motion.scaleMultiplier,
    positionOffset: EDITABLE_NUMERIC_CONTROLS.avatars.judge.motion.positionOffset,
    rotationOffsetY: EDITABLE_NUMERIC_CONTROLS.avatars.judge.motion.rotationOffsetY,
    sitting: NON_NUMERIC_AVATAR_RUNTIME.judge.sitting,
    stationary: NON_NUMERIC_AVATAR_RUNTIME.judge.stationary,
    poseOverride: NON_NUMERIC_AVATAR_RUNTIME.judge.poseOverride,
    frozenPose: {
      enabled: NON_NUMERIC_AVATAR_RUNTIME.judge.frozenPose.enabled,
      assetId: NON_NUMERIC_AVATAR_RUNTIME.judge.frozenPose.assetId,
      time: EDITABLE_NUMERIC_CONTROLS.avatars.judge.motion.frozenPoseTime,
      clipName: NON_NUMERIC_AVATAR_RUNTIME.judge.frozenPose.clipName,
    },
    animation: {
      enabled: NON_NUMERIC_AVATAR_RUNTIME.judge.animation.enabled,
      assetId: NON_NUMERIC_AVATAR_RUNTIME.judge.animation.assetId,
      loop: NON_NUMERIC_AVATAR_RUNTIME.judge.animation.loop,
      speed: EDITABLE_NUMERIC_CONTROLS.avatars.judge.motion.animationSpeed,
      clipName: NON_NUMERIC_AVATAR_RUNTIME.judge.animation.clipName,
      overrideSitting: NON_NUMERIC_AVATAR_RUNTIME.judge.animation.overrideSitting,
      overrideStationary: NON_NUMERIC_AVATAR_RUNTIME.judge.animation.overrideStationary,
    },
  },
  counsel: {
    defaultAssetId: NON_NUMERIC_AVATAR_RUNTIME.counsel.defaultAssetId,
    scaleMultiplier: EDITABLE_NUMERIC_CONTROLS.avatars.counsel.motion.scaleMultiplier,
    positionOffset: EDITABLE_NUMERIC_CONTROLS.avatars.counsel.motion.positionOffset,
    rotationOffsetY: EDITABLE_NUMERIC_CONTROLS.avatars.counsel.motion.rotationOffsetY,
    sitting: NON_NUMERIC_AVATAR_RUNTIME.counsel.sitting,
    stationary: NON_NUMERIC_AVATAR_RUNTIME.counsel.stationary,
    poseOverride: NON_NUMERIC_AVATAR_RUNTIME.counsel.poseOverride,
    frozenPose: {
      enabled: NON_NUMERIC_AVATAR_RUNTIME.counsel.frozenPose.enabled,
      assetId: NON_NUMERIC_AVATAR_RUNTIME.counsel.frozenPose.assetId,
      time: EDITABLE_NUMERIC_CONTROLS.avatars.counsel.motion.frozenPoseTime,
      clipName: NON_NUMERIC_AVATAR_RUNTIME.counsel.frozenPose.clipName,
    },
    animation: {
      enabled: NON_NUMERIC_AVATAR_RUNTIME.counsel.animation.enabled,
      assetId: NON_NUMERIC_AVATAR_RUNTIME.counsel.animation.assetId,
      loop: NON_NUMERIC_AVATAR_RUNTIME.counsel.animation.loop,
      speed: EDITABLE_NUMERIC_CONTROLS.avatars.counsel.motion.animationSpeed,
      clipName: NON_NUMERIC_AVATAR_RUNTIME.counsel.animation.clipName,
      overrideSitting: NON_NUMERIC_AVATAR_RUNTIME.counsel.animation.overrideSitting,
      overrideStationary: NON_NUMERIC_AVATAR_RUNTIME.counsel.animation.overrideStationary,
    },
  },
}

export function getAvatarAssetLibrary(
  role: AvatarRole,
  judgeDifficulty: JudgeAvatarDifficulty = 'medium'
): Record<string, string> {
  if (role !== 'judge') return AVATAR_GLB_ASSETS[role]
  return JUDGE_AVATAR_ASSETS_BY_DIFFICULTY[judgeDifficulty] ?? JUDGE_AVATAR_ASSETS_BY_DIFFICULTY.medium
}

export function getAvatarAssetUrl(
  role: AvatarRole,
  assetId: string,
  judgeDifficulty: JudgeAvatarDifficulty = 'medium'
): string {
  const assets = getAvatarAssetLibrary(role, judgeDifficulty)
  const runtime = AVATAR_RUNTIME_SETTINGS[role]
  const fallback = assets[runtime.defaultAssetId] ?? Object.values(assets)[0]
  return assets[assetId] ?? fallback
}

export function getActiveAvatarUrl(role: AvatarRole, judgeDifficulty: JudgeAvatarDifficulty = 'medium'): string {
  const runtime = AVATAR_RUNTIME_SETTINGS[role]
  const activeAssetId = runtime.animation.enabled
    ? runtime.animation.assetId
    : runtime.frozenPose.enabled
      ? runtime.frozenPose.assetId
      : runtime.defaultAssetId
  return getAvatarAssetUrl(role, activeAssetId, judgeDifficulty)
}

export function getAvatarRenderState(role: AvatarRole): { sitting: boolean; stationary: boolean } {
  const runtime = AVATAR_RUNTIME_SETTINGS[role]
  if (!runtime.animation.enabled) {
    return {
      sitting: runtime.sitting,
      stationary: runtime.stationary,
    }
  }
  return {
    sitting: runtime.animation.overrideSitting ?? runtime.sitting,
    stationary: runtime.animation.overrideStationary ?? runtime.stationary,
  }
}

export default SCENE_PRESETS
