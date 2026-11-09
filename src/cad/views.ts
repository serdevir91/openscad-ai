import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

const ANGLES: [number, number, number][] = [[1, -1.2, 0.9], [0, 0, 1], [0, -1, 0], [1, 0, 0]];

function scene(stl: Uint8Array) {
  const geometry = new STLLoader().parse(stl.slice().buffer as ArrayBuffer);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const root = new THREE.Scene();
  root.background = new THREE.Color(0xffffff);
  root.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xb8c2cc, roughness: 0.7, metalness: 0.05 })));
  const edges = new THREE.EdgesGeometry(geometry, 28);
  root.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x27323c })));
  root.add(new THREE.HemisphereLight(0xffffff, 0x8a96a3, 2));
  const light = new THREE.DirectionalLight(0xffffff, 2);
  root.add(light);
  return { root, light, geometry, edges, sphere: geometry.boundingSphere! };
}

function shoot(stl: Uint8Array, angles: [number, number, number][], width: number, height: number) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  const { root, light, geometry, edges, sphere } = scene(stl);
  try {
    renderer.setSize(width, height, false);
    const aspect = width / height, r = sphere.radius * 1.12 || 1;
    const camera = new THREE.OrthographicCamera(-r * aspect, r * aspect, r, -r, 0.01, r * 20);
    return angles.map(angle => {
      const direction = new THREE.Vector3(...angle).normalize();
      camera.up.set(0, angle[2] === 1 ? 1 : 0, angle[2] === 1 ? 0 : 1);
      camera.position.copy(sphere.center).addScaledVector(direction, r * 8);
      camera.lookAt(sphere.center);
      camera.updateProjectionMatrix();
      light.position.copy(camera.position).add(new THREE.Vector3(r, r, r * 2));
      renderer.render(root, camera);
      return renderer.domElement.toDataURL('image/png').split(',')[1];
    });
  } finally {
    geometry.dispose();
    edges.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

/** Isometric, top, front, and right views for a vision model to inspect. */
export async function renderViews(stl: Uint8Array) {
  return shoot(stl, ANGLES, 640, 640).map(data => ({ mime: 'image/png', data }));
}

export function renderPng(stl: Uint8Array) {
  return Uint8Array.from(atob(shoot(stl, [ANGLES[0]], 1600, 1200)[0]), character => character.charCodeAt(0));
}
