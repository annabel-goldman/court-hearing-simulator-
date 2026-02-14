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
export type { SpeakingRole, SimulationPhase, SessionConfig } from './types'
export { VISEME_MAP } from './types'

// Scene configuration
export { SCENE_PRESETS, PRESET_DEFAULT } from './scenePresets'
export type { SceneConfig, AvatarConfig, AvatarPoseConfig, PresetName } from './scenePresets'
