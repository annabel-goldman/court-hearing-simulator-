import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { useAnimations, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'

type EntrancePhase = 'walk' | 'sit' | 'seated'

interface JudgeEntranceSequenceProps {
  startPosition: [number, number, number]
  approachPosition: [number, number, number]
  chairPosition: [number, number, number]
  rotationY: number
  scale: number
  walkUrl: string
  sitTransitionUrl: string
  seatedIdleUrl: string
}

interface RiggedJudgeClipProps {
  url: string
  loop: boolean
  onFinished?: () => void
}

function toRadians(rotationY: number): [number, number, number] {
  return [0, (rotationY * Math.PI) / 180, 0]
}

function RiggedJudgeClip({ url, loop, onFinished }: RiggedJudgeClipProps) {
  const clipRootRef = useRef<THREE.Group>(null)
  const { scene, animations } = useGLTF(url)
  const clonedScene = useMemo(() => {
    const cloneFn = (SkeletonUtils as { clone?: (source: THREE.Object3D) => THREE.Object3D }).clone
    if (cloneFn) {
      return cloneFn(scene) as THREE.Group
    }
    return scene.clone(true)
  }, [scene])

  const { actions, names, mixer } = useAnimations(animations, clipRootRef)

  useEffect(() => {
    const clipName = names[0]
    const action = clipName ? actions[clipName] : undefined
    if (!action) return

    action.reset()
    action.enabled = true
    action.setEffectiveTimeScale(1)
    action.setEffectiveWeight(1)
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1)
    action.clampWhenFinished = !loop
    action.play()

    const handleFinished = (event: THREE.Event & { action?: THREE.AnimationAction }) => {
      if (event.action === action) {
        onFinished?.()
      }
    }

    mixer.addEventListener('finished', handleFinished)
    return () => {
      mixer.removeEventListener('finished', handleFinished)
      action.stop()
    }
  }, [actions, names, mixer, loop, onFinished, url])

  return (
    <group ref={clipRootRef}>
      <primitive object={clonedScene} />
    </group>
  )
}

export function JudgeEntranceSequence({
  startPosition,
  approachPosition,
  chairPosition,
  rotationY,
  scale,
  walkUrl,
  sitTransitionUrl,
  seatedIdleUrl,
}: JudgeEntranceSequenceProps) {
  const rootRef = useRef<THREE.Group>(null)
  const [phase, setPhase] = useState<EntrancePhase>('walk')
  const phaseElapsedRef = useRef(0)

  const WALK_DURATION_SECONDS = 6.2
  const SIT_TRANSITION_MAX_SECONDS = 6.0

  useFrame((_, delta) => {
    phaseElapsedRef.current += delta

    if (!rootRef.current) return

    if (phase === 'walk') {
      const t = Math.min(phaseElapsedRef.current / WALK_DURATION_SECONDS, 1)
      rootRef.current.position.lerpVectors(
        new THREE.Vector3(...startPosition),
        new THREE.Vector3(...approachPosition),
        t
      )
      if (t >= 1) {
        setPhase('sit')
        phaseElapsedRef.current = 0
      }
      return
    }

    if (phase === 'sit') {
      const t = Math.min(phaseElapsedRef.current / SIT_TRANSITION_MAX_SECONDS, 1)
      rootRef.current.position.lerpVectors(
        new THREE.Vector3(...approachPosition),
        new THREE.Vector3(...chairPosition),
        t
      )
      if (t >= 1) {
        setPhase('seated')
        phaseElapsedRef.current = 0
      }
      return
    }

    rootRef.current.position.set(...chairPosition)
  })

  const handleSitAnimationFinished = () => {
    setPhase((current) => (current === 'sit' ? 'seated' : current))
    phaseElapsedRef.current = 0
  }

  return (
    <group ref={rootRef} position={startPosition} rotation={toRadians(rotationY)} scale={scale}>
      {phase === 'walk' && <RiggedJudgeClip key="judge-walk" url={walkUrl} loop={true} />}
      {phase === 'sit' && (
        <RiggedJudgeClip
          key="judge-sit-transition"
          url={sitTransitionUrl}
          loop={false}
          onFinished={handleSitAnimationFinished}
        />
      )}
      {phase === 'seated' && <RiggedJudgeClip key="judge-seated-idle" url={seatedIdleUrl} loop={true} />}
    </group>
  )
}
