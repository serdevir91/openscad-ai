import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { Box, RotateCcw, ScanLine, Palette } from 'lucide-react';

const MATERIALS = [
  { id: 'amber', name: 'CAD Amber', color: 0xf3a65a, rough: 0.35, metal: 0.25 },
  { id: 'clay', name: 'Technical Clay', color: 0xe2e8f0, rough: 0.65, metal: 0.05 },
  { id: 'steel', name: 'Metallic Steel', color: 0x94a3b8, rough: 0.2, metal: 0.85 },
  { id: 'cyan', name: 'Blueprint Cyan', color: 0x38bdf8, rough: 0.3, metal: 0.35 },
];

export default function Viewport3D({ stl, theme }: { stl?: string; theme: string }) {
  const host = useRef<HTMLDivElement>(null);
  const setCameraAngle = useRef<(angle: 'iso' | 'top' | 'front' | 'side') => void>(() => {});
  const [wire, setWire] = useState(false);
  const [matIndex, setMatIndex] = useState(0);
  const [error, setError] = useState('');

  const currentMat = MATERIALS[matIndex];

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    setError('');

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setError('WebGL could not start. Check your graphics driver.');
      return;
    }

    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100000);
    camera.up.set(0, 0, 1);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const gridColor1 = theme === 'light' ? 0xaab3bc : 0x39434c;
    const gridColor2 = theme === 'light' ? 0xd4d9dd : 0x242d35;
    const grid = new THREE.GridHelper(400, 40, gridColor1, gridColor2);
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x64748b, 2.5));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(50, -80, 120);
    scene.add(light);

    const fill = new THREE.DirectionalLight(0xffa75e, 1.5);
    fill.position.set(-80, 60, 40);
    scene.add(fill);

    let geometry: THREE.BufferGeometry | undefined;
    const material = new THREE.MeshStandardMaterial({
      color: currentMat.color,
      roughness: currentMat.rough,
      metalness: currentMat.metal,
      wireframe: wire,
    });

    let radius = 65;
    const center = new THREE.Vector3(0, 0, 15);

    if (stl) {
      try {
        const bytes = Uint8Array.from(atob(stl), c => c.charCodeAt(0));
        geometry = new STLLoader().parse(bytes.buffer);
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        const box = geometry.boundingBox!;
        box.getCenter(center);
        radius = Math.max(box.getSize(new THREE.Vector3()).length(), 1);
        const mesh = new THREE.Mesh(geometry, material);
        scene.add(mesh);
        grid.position.z = box.min.z - 0.02;
        grid.scale.setScalar(Math.max(radius / 150, 0.1));
      } catch (e) {
        setError(`The STL could not be read: ${e}`);
      }
    }

    const applyAngle = (angle: 'iso' | 'top' | 'front' | 'side') => {
      if (angle === 'top') {
        camera.up.set(0, 1, 0);
        camera.position.set(center.x, center.y, center.z + radius * 2.2);
      } else if (angle === 'front') {
        camera.up.set(0, 0, 1);
        camera.position.set(center.x, center.y - radius * 2.2, center.z);
      } else if (angle === 'side') {
        camera.up.set(0, 0, 1);
        camera.position.set(center.x + radius * 2.2, center.y, center.z);
      } else {
        camera.up.set(0, 0, 1);
        camera.position.copy(center).add(new THREE.Vector3(radius * 1.3, -radius * 1.6, radius * 1.1));
      }
      camera.near = Math.max(radius / 10000, 0.001);
      camera.far = radius * 100;
      camera.updateProjectionMatrix();
      controls.target.copy(center);
      controls.update();
    };

    setCameraAngle.current = applyAngle;
    applyAngle('iso');

    const resize = new ResizeObserver(() => {
      camera.aspect = el.clientWidth / Math.max(el.clientHeight, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
    });
    resize.observe(el);

    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      controls.update();
      renderer.render(scene, camera);
    };
    draw();

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      geometry?.dispose();
      material.dispose();
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [stl, theme, wire, matIndex, currentMat]);

  const cycleMaterial = () => {
    setMatIndex((matIndex + 1) % MATERIALS.length);
  };

  return (
    <div className="viewport">
      <div ref={host} className="canvas" />
      <div className="view-tools">
        <span>PERSPECTIVE <small>/ mm</small></span>
        <button title="Isometric view" onClick={() => setCameraAngle.current('iso')}>ISO</button>
        <button title="Top view" onClick={() => setCameraAngle.current('top')}>TOP</button>
        <button title="Front view" onClick={() => setCameraAngle.current('front')}>FRONT</button>
        <button title="Side view" onClick={() => setCameraAngle.current('side')}>SIDE</button>
        <button title={`Material: ${currentMat.name}`} onClick={cycleMaterial}>
          <Palette size={14} style={{ color: '#' + currentMat.color.toString(16).padStart(6, '0') }} />
        </button>
        <button title="Wireframe" aria-pressed={wire} onClick={() => setWire(!wire)}>
          <ScanLine size={16} />
        </button>
        <button title="Reset view" onClick={() => setCameraAngle.current('iso')}>
          <RotateCcw size={16} />
        </button>
      </div>
      {!stl && !error && (
        <div className="empty">
          <Box size={42} />
          <h3>Start with an idea.</h3>
          <p>Compile your code and explore the geometry here.</p>
        </div>
      )}
      {error && <div className="empty error">{error}</div>}
      <div className="axis">
        <b>Z</b>
        <span>Y</span>
        <i>X</i>
      </div>
      <div className="view-hint">LEFT · ORBIT &nbsp; RIGHT · PAN &nbsp; WHEEL · ZOOM</div>
    </div>
  );
}
