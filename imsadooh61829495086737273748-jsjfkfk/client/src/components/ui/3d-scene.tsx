import { Canvas } from '@react-three/fiber';
import { OrbitControls, Float, Text3D, Center, MeshTransmissionMaterial } from '@react-three/drei';
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Mesh } from 'three';

function MessageCard({ position, color }: { position: [number, number, number]; color: string }) {
  const meshRef = useRef<Mesh>(null);

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.position.y = position[1] + Math.sin(state.clock.elapsedTime + position[0]) * 0.1;
    }
  });

  return (
    <Float speed={2} rotationIntensity={0.2} floatIntensity={0.5}>
      <mesh ref={meshRef} position={position}>
        <boxGeometry args={[1.2, 0.7, 0.1]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={0.8}
          roughness={0.2}
          metalness={0.8}
        />
      </mesh>
    </Float>
  );
}

function PhoneModel() {
  return (
    <group>
      <mesh>
        <boxGeometry args={[2, 3.5, 0.2]} />
        <meshStandardMaterial color="#1a1a2e" roughness={0.3} metalness={0.7} />
      </mesh>
      <mesh position={[0, 0, 0.11]}>
        <boxGeometry args={[1.8, 3.2, 0.02]} />
        <meshStandardMaterial color="#0a0f1f" emissive="#00aaff" emissiveIntensity={0.2} />
      </mesh>
    </group>
  );
}

function Scene() {
  return (
    <>
      <ambientLight intensity={0.5} />
      <spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} intensity={1} />
      <pointLight position={[-10, -10, -10]} intensity={0.5} color="#00aaff" />
      
      <Center>
        <group>
          <PhoneModel />
          <MessageCard position={[2.5, 1.5, 0.5]} color="#00aaff" />
          <MessageCard position={[2.8, 0, 0.3]} color="#10b981" />
          <MessageCard position={[2.5, -1.5, 0.5]} color="#3b82f6" />
        </group>
      </Center>

      <OrbitControls
        enableZoom={false}
        enablePan={false}
        minPolarAngle={Math.PI / 3}
        maxPolarAngle={Math.PI / 2}
        autoRotate
        autoRotateSpeed={1}
      />
    </>
  );
}

export default function Scene3D() {
  return (
    <div className="w-full h-full min-h-[500px]">
      <Canvas
        camera={{ position: [0, 0, 8], fov: 50 }}
        dpr={[1, 2]}
      >
        <Scene />
      </Canvas>
    </div>
  );
}
