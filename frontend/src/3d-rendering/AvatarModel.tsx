/**
 * AvatarModel Component
 * 
 * Renders a Ready Player Me avatar with lip-sync support.
 * Handles sitting pose and morph target animations.
 */

import { useState, useRef, useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { Lipsync } from 'wawa-lipsync'
import * as THREE from 'three'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { AvatarPoseConfig } from './scenePresets'
import { VISEME_MAP } from './types'

export interface AvatarModelProps {
  url: string
  position: [number, number, number]
  rotation?: [number, number, number]
  scale?: number
  lipsyncManager: Lipsync | null
  isSpeaking: boolean
  label?: string
  sitting?: boolean
  poseConfig?: AvatarPoseConfig
}

export function AvatarModel({ 
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
    const cloneFn = (SkeletonUtils as any).clone || (SkeletonUtils as any).default?.clone || SkeletonUtils
    return cloneFn(scene) as THREE.Group
  }, [scene])

  // Find all meshes with morph targets in the cloned scene and apply sitting pose
  useEffect(() => {
    const meshes: THREE.SkinnedMesh[] = []
    clonedScene.traverse((child) => {
      // Disable frustum culling for ALL objects to prevent disappearing during animations
      if ((child as any).frustumCulled !== undefined) {
        (child as any).frustumCulled = false
      }
      
      if (child instanceof THREE.Mesh || child instanceof THREE.SkinnedMesh) {
        child.frustumCulled = false
        
        if (child.geometry) {
          child.geometry.computeBoundingSphere()
          if (child.geometry.boundingSphere) {
            child.geometry.boundingSphere.radius *= 3
          }
        }
      }
      
      if (child instanceof THREE.SkinnedMesh && child.morphTargetDictionary && child.morphTargetInfluences) {
        meshes.push(child)
      }
      
      // Apply sitting pose by rotating skeleton bones
      if (sitting && child instanceof THREE.Bone) {
        const boneName = child.name.toLowerCase()
        
        if (boneName.includes('hips') || boneName.includes('pelvis')) {
          child.rotation.x = pose.hipTiltX
        }
        if (boneName.includes('upleg') || boneName.includes('thigh') || boneName.includes('upperleg')) {
          child.rotation.z = 0
          child.rotation.x = pose.thighRotationX
        }
        if (boneName.includes('leg') && (boneName.includes('left') || boneName.includes('right')) && 
            !boneName.includes('up') && !boneName.includes('upper') && !boneName.includes('thigh')) {
          child.rotation.z = 0
          child.rotation.x = pose.calfRotationX
        }
        if (boneName.includes('foot')) {
          child.rotation.z = 0
          child.rotation.x = pose.footRotationX
        }
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

    try {
      lipsyncManager.processAudio()
    } catch (e) {
      return
    }
    
    const currentViseme = lipsyncManager.viseme
    const visemeName = VISEME_MAP[currentViseme] || 'viseme_sil'
    const rawIntensity = (lipsyncManager as any).volume as number
    
    let intensity = 0
    if (typeof rawIntensity === 'number' && isFinite(rawIntensity) && !isNaN(rawIntensity)) {
      intensity = Math.max(0, Math.min(rawIntensity * 1.2, 0.5))
    }

    morphTargetMeshes.forEach(mesh => {
      if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
        Object.values(VISEME_MAP).forEach(name => {
          const index = mesh.morphTargetDictionary![name]
          if (index !== undefined) {
            const targetValue = name === visemeName ? intensity : 0
            mesh.morphTargetInfluences![index] = THREE.MathUtils.lerp(
              mesh.morphTargetInfluences![index],
              targetValue,
              0.25
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
