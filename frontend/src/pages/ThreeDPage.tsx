import { useRef } from 'react'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { CourtroomScene } from '../3d-rendering/CourtroomScene'
import type { JudgeAvatarDifficulty } from '../3d-rendering/types'

function readStoredJudgeAvatarDifficulty(): JudgeAvatarDifficulty {
  const stored = localStorage.getItem('judgeAvatarDifficulty')
  return stored === 'easy' || stored === 'hard' || stored === 'medium' ? stored : 'medium'
}

export default function ThreeDPage() {
  const orbitControlsRef = useRef<OrbitControlsImpl>(null)
  const judgeDifficulty = readStoredJudgeAvatarDifficulty()

  return (
    <div className="avatar-page courtroom-fullscreen">
      <div className="courtroom-canvas-fullscreen">
        <CourtroomScene
          speakingRole={null}
          lipsyncManager={null}
          orbitControlsRef={orbitControlsRef}
          judgeDifficulty={judgeDifficulty}
        />
      </div>
    </div>
  )
}
