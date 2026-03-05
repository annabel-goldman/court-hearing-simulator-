/**
 * 3D Rendering Module
 * 
 * Re-exports all 3D components, types, and configurations for the courtroom scene.
 */

// Components
export { CourtroomScene } from './CourtroomScene'
export type { CourtroomSceneProps } from './CourtroomScene'
export { Courtroom } from './Courtroom'
export { AvatarModel } from './AvatarModel'
export type { AvatarModelProps } from './AvatarModel'

// Types
export type { JudgeAvatarDifficulty, SpeakingRole, SimulationPhase, SessionConfig } from './types'
export { VISEME_MAP } from './types'

// Scene configuration
export {
  AVATAR_GLB_ASSETS,
  AVATAR_RUNTIME_SETTINGS,
  AVATAR_SCENE_SETTINGS,
  BEAM_CONSTANTS,
  CHAIR_CONSTANTS,
  DEFAULT_JUDGE_POSE,
  DEFAULT_LAWYER_POSE,
  EDITABLE_NUMERIC_CONTROLS,
  FLAG_CONSTANTS,
  FURNITURE_GLB_SETTINGS,
  JUDGE_AVATAR_ASSETS_BY_DIFFICULTY,
  JUDGE_DESK_CONSTANTS,
  LAWYER_DESK_CONSTANTS,
  WINDOW_SKY_BACKDROP_SETTINGS,
  PRESET_DEFAULT,
  SCENE_PRESETS,
  getAvatarAssetLibrary,
  getActiveAvatarUrl,
  getAvatarAssetUrl,
  getAvatarRenderState,
} from './scenePresets'
export type {
  AvatarConfig,
  AvatarPoseConfig,
  AvatarRole,
  AvatarAnimationAssignment,
  AvatarFrozenPoseAssignment,
  GlbPlacementConfig,
  AvatarRuntimeConfig,
  PresetName,
  SceneConfig,
} from './scenePresets'
