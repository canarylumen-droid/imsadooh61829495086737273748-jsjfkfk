import { useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, SMAAPreset } from 'postprocessing';

import './Hyperspeed.css';

interface HyperspeedProps {
  effectOptions?: Record<string, any>;
}

const DEFAULT_EFFECT_OPTIONS = {
  onSpeedUp: () => {},
  onSlowDown: () => {},
  distortion: 'turbulentDistortion',
  length: 400,
  roadWidth: 10,
  islandWidth: 2,
  lanesPerRoad: 3,
  fov: 90,
  fovSpeedUp: 150,
  speedUp: 2,
  carLightsFade: 0.4,
  totalSideLightSticks: 20,
  lightPairsPerRoadWay: 40,
  shoulderLinesWidthPercentage: 0.05,
  brokenLinesWidthPercentage: 0.1,
  brokenLinesLengthPercentage: 0.5,
  lightStickWidth: [0.12, 0.5],
  lightStickHeight: [1.3, 1.7],
  movingAwaySpeed: [60, 80],
  movingCloserSpeed: [-120, -160],
  carLightsLength: [12, 80],
  carLightsRadius: [0.05, 0.14],
  carWidthPercentage: [0.3, 0.5],
  carShiftX: [-0.8, 0.8],
  carFloorSeparation: [0, 5],
  colors: {
    roadColor: 0x080808,
    islandColor: 0x0a0a0a,
    background: 0x000000,
    shoulderLines: 0x131313,
    brokenLines: 0x2196f3,
    leftCars: [0xff4500, 0xff6347, 0xff7f50],
    rightCars: [0x00bfff, 0x00ced1, 0x00e5ff],
    sticks: 0x2196f3
  }
};

const Hyperspeed: React.FC<HyperspeedProps> = ({ effectOptions = DEFAULT_EFFECT_OPTIONS }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    renderer?: THREE.WebGLRenderer;
    scene?: THREE.Scene;
    camera?: THREE.PerspectiveCamera;
    composer?: EffectComposer;
    clock?: THREE.Clock;
    animationFrameId?: number;
  }>({});

  const memoOptions = useMemo(() => ({ ...DEFAULT_EFFECT_OPTIONS, ...effectOptions }), [effectOptions]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(memoOptions.colors.background, 1);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(memoOptions.fov, width / height, 0.1, 10000);
    camera.position.z = -5;
    camera.position.y = 8;

    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    const bloomPass = new EffectPass(camera, new BloomEffect({
      luminanceThreshold: 0.2,
      luminanceSmoothing: 0,
      resolutionScale: 1
    }));
    composer.addPass(bloomPass);

    const smaaPass = new EffectPass(camera, new SMAAEffect({
      preset: SMAAPreset.MEDIUM,
      searchImage: SMAAEffect.searchImageDataURL,
      areaImage: SMAAEffect.areaImageDataURL
    }));
    composer.addPass(smaaPass);

    const clock = new THREE.Clock();

    // Create simple road geometry
    const roadGeometry = new THREE.PlaneGeometry(memoOptions.roadWidth * 2, memoOptions.length * 4);
    const roadMaterial = new THREE.MeshBasicMaterial({ color: memoOptions.colors.roadColor });
    const road = new THREE.Mesh(roadGeometry, roadMaterial);
    road.position.z = -memoOptions.length * 2;
    scene.add(road);

    // Create light sticks
    const sticks = new THREE.Group();
    for (let i = 0; i < memoOptions.totalSideLightSticks; i++) {
      const stickGeometry = new THREE.BoxGeometry(0.3, memoOptions.lightStickHeight[0], 0.3);
      const stickMaterial = new THREE.MeshBasicMaterial({ color: memoOptions.colors.sticks });
      const stick = new THREE.Mesh(stickGeometry, stickMaterial);
      
      const isLeftSide = Math.random() > 0.5;
      stick.position.x = isLeftSide ? -memoOptions.roadWidth : memoOptions.roadWidth;
      stick.position.z = -(i * 20);
      stick.position.y = 0;
      
      sticks.add(stick);
    }
    scene.add(sticks);

    // Create cars (light points)
    const cars = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const lightGeometry = new THREE.SphereGeometry(0.3, 8, 8);
      const lightMaterial = new THREE.MeshBasicMaterial({ color: memoOptions.colors.leftCars[i % 3] });
      const light = new THREE.Mesh(lightGeometry, lightMaterial);
      light.position.z = -(i * 40);
      light.position.x = 0;
      cars.add(light);
    }
    scene.add(cars);

    sceneRef.current = { renderer, scene, camera, composer, clock };

    function animate() {
      sceneRef.current.animationFrameId = requestAnimationFrame(animate);
      
      const elapsed = clock.getElapsedTime();
      
      // Animate sticks
      sticks.children.forEach((stick, i) => {
        stick.position.z += 2;
        if (stick.position.z > 50) {
          stick.position.z = -memoOptions.length * 2;
        }
      });

      // Animate cars
      cars.children.forEach((car, i) => {
        car.position.z += 2.5;
        car.position.x = Math.sin(elapsed * 0.5 + i) * (memoOptions.roadWidth * 0.3);
        if (car.position.z > 100) {
          car.position.z = -memoOptions.length * 2;
        }
      });

      // Update camera
      camera.position.y = 8 + Math.sin(elapsed * 0.3) * 2;

      composer.render();
    }

    animate();

    // Handle resize
    function handleResize() {
      const newWidth = container.clientWidth || window.innerWidth;
      const newHeight = container.clientHeight || window.innerHeight;
      
      camera.aspect = newWidth / newHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, newHeight);
      composer.setSize(newWidth, newHeight);
    }

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (sceneRef.current.animationFrameId) {
        cancelAnimationFrame(sceneRef.current.animationFrameId);
      }
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
      composer.dispose();
    };
  }, [memoOptions]);

  return <div ref={containerRef} className="hyperspeed-container" />;
};

export default Hyperspeed;
