export type LandingIntroAvatarKey = 'opposingCounsel' | 'judge'
export type LandingIntroAvatarFacing = 'left' | 'right'
export type LandingIntroAnimationAssetId = 'agreeGesture' | 'seatedAnswering' | 'standAndChat'

interface LandingIntroAvatarConfig {
  facing: LandingIntroAvatarFacing
  animationAssetId: LandingIntroAnimationAssetId
  shellOffsetXPx: number
  shellOffsetYPx: number
  scale: number
  xOffset: number
  yOffset: number
  zOffset: number
  animationSpeed: number
}

export const LANDING_INTRO_AVATAR_CONFIG: {
  row: {
    maxWidthPx: number
    gapPx: number
    offsetXPx: number
    offsetYPx: number
  }
  opposingCounsel: LandingIntroAvatarConfig
  judge: LandingIntroAvatarConfig
} = {
  row: {
    // Increase this to spread avatars farther apart.
    maxWidthPx: 1120,
    gapPx: 300,
    offsetXPx: 0,
    offsetYPx: 0,
  },
  opposingCounsel: {
    facing: 'right',
    animationAssetId: 'standAndChat',
    shellOffsetXPx: -28,
    shellOffsetYPx: 0,
    scale: 1.14,
    xOffset: 0,
    yOffset: -1.1,
    zOffset: 0,
    animationSpeed: 0.92,
  },
  judge: {
    facing: 'left',
    animationAssetId: 'standAndChat',
    shellOffsetXPx: 28,
    shellOffsetYPx: 0,
    scale: 1.14,
    xOffset: 0,
    yOffset: -1.1,
    zOffset: 0,
    animationSpeed: 0.92,
  },
}
