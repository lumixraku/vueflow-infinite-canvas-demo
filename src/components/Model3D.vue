<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

// A real interactive three.js viewer for the workflow's 3D model.
// mode: 'model' (solid) | 'wireframe' | 'rig' (skeleton overlay) | 'split' (exploded mesh parts)
const props = defineProps({
  mode: { type: String, default: 'model' },
  src: { type: String, default: '/models/shark-gardener.glb' },
  autoRotate: { type: Boolean, default: true },
  sectors: { type: Number, default: 7 },
})

const host = ref(null)
let renderer, scene, camera, controls, pivot, raf, resizeObserver, disposed = false

function fitAndCenter(geometry) {
  geometry.computeBoundingBox()
  const box = geometry.boundingBox
  const center = new THREE.Vector3()
  const size = new THREE.Vector3()
  box.getCenter(center)
  box.getSize(size)
  geometry.translate(-center.x, -center.y, -center.z)
  return size
}

function radialSplit(geometry, material, sectors, explodeDist) {
  const geo = geometry.index ? geometry.toNonIndexed() : geometry
  const pos = geo.attributes.position
  const nor = geo.attributes.normal
  const uv = geo.attributes.uv
  const tris = pos.count / 3
  const buckets = Array.from({ length: sectors }, () => ({ p: [], n: [], u: [] }))
  for (let t = 0; t < tris; t++) {
    let cx = 0, cz = 0
    for (let k = 0; k < 3; k++) { const i = t * 3 + k; cx += pos.getX(i); cz += pos.getZ(i) }
    cx /= 3; cz /= 3
    const ang = Math.atan2(cz, cx)
    const s = Math.min(sectors - 1, Math.floor(((ang + Math.PI) / (2 * Math.PI)) * sectors))
    const b = buckets[s]
    for (let k = 0; k < 3; k++) {
      const i = t * 3 + k
      b.p.push(pos.getX(i), pos.getY(i), pos.getZ(i))
      if (nor) b.n.push(nor.getX(i), nor.getY(i), nor.getZ(i))
      if (uv) b.u.push(uv.getX(i), uv.getY(i))
    }
  }
  const group = new THREE.Group()
  buckets.forEach((b, s) => {
    if (!b.p.length) return
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3))
    if (b.u.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(b.u, 2))
    if (b.n.length) g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3))
    else g.computeVertexNormals()
    const mesh = new THREE.Mesh(g, material)
    const mid = -Math.PI + ((s + 0.5) / sectors) * 2 * Math.PI
    mesh.position.set(Math.cos(mid) * explodeDist, 0, Math.sin(mid) * explodeDist)
    mesh.userData.explodeDir = new THREE.Vector3(Math.cos(mid), 0, Math.sin(mid))
    group.add(mesh)
  })
  return group
}

function buildSkeleton(size) {
  const sx = size.x, sy = size.y, sz = size.z
  const P = (x, y, z) => new THREE.Vector3(x * sx, y * sy, z * sz)
  const head = P(0, 0.44, 0.02), neck = P(0, 0.30, 0), chest = P(0, 0.12, 0), pelvis = P(0, -0.10, 0)
  const shL = P(-0.13, 0.14, 0), shR = P(0.13, 0.14, 0)
  const elbowL = P(-0.22, -0.02, 0.02), elbowR = P(0.22, -0.02, 0.02)
  const handL = P(-0.26, -0.16, 0.04), handR = P(0.26, -0.16, 0.04)
  const hipL = P(-0.09, -0.12, 0), hipR = P(0.09, -0.12, 0)
  const kneeL = P(-0.10, -0.32, 0.02), kneeR = P(0.10, -0.32, 0.02)
  const footL = P(-0.10, -0.48, 0.04), footR = P(0.10, -0.48, 0.04)
  const bones = [
    [head, neck], [neck, chest], [chest, pelvis],
    [chest, shL], [shL, elbowL], [elbowL, handL],
    [chest, shR], [shR, elbowR], [elbowR, handR],
    [pelvis, hipL], [hipL, kneeL], [kneeL, footL],
    [pelvis, hipR], [hipR, kneeR], [kneeR, footR],
  ]
  const joints = [head, neck, chest, pelvis, shL, shR, elbowL, elbowR, handL, handR, hipL, hipR, kneeL, kneeR, footL, footR]
  const group = new THREE.Group()
  const pts = []
  for (const [a, b] of bones) pts.push(a, b)
  const lineGeo = new THREE.BufferGeometry().setFromPoints(pts)
  group.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0x33691e, depthTest: false, transparent: true })))
  const r = Math.max(sx, sy, sz) * 0.022
  const jointGeo = new THREE.SphereGeometry(r, 16, 12)
  const jointMat = new THREE.MeshBasicMaterial({ color: 0x8bc34a, depthTest: false })
  for (const j of joints) {
    const s = new THREE.Mesh(jointGeo, jointMat)
    s.position.copy(j)
    group.add(s)
  }
  group.renderOrder = 2
  return group
}

function applyMode(root, mode, sectors) {
  let mesh = null
  root.updateMatrixWorld(true)
  root.traverse((o) => { if (!mesh && o.isMesh) mesh = o })
  if (!mesh) return root

  const geo = mesh.geometry.clone()
  geo.applyMatrix4(mesh.matrixWorld)
  const size = fitAndCenter(geo)
  const maxDim = Math.max(size.x, size.y, size.z) || 1
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material

  const content = new THREE.Group()
  if (mode === 'split') {
    content.add(radialSplit(geo, material, sectors, maxDim * 0.34))
  } else if (mode === 'rig') {
    const mat = material.clone()
    mat.transparent = true
    mat.opacity = 0.55
    content.add(new THREE.Mesh(geo, mat))
    content.add(buildSkeleton(size))
  } else if (mode === 'wireframe') {
    const mat = material.clone()
    mat.wireframe = true
    content.add(new THREE.Mesh(geo, mat))
  } else {
    content.add(new THREE.Mesh(geo, material))
  }
  const scale = 2 / maxDim
  content.scale.setScalar(scale)
  return content
}

function init() {
  const el = host.value
  const width = el.clientWidth || 320
  const height = el.clientHeight || 320

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(width, height)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  el.appendChild(renderer.domElement)

  scene = new THREE.Scene()
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture

  camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100)
  camera.position.set(0.4, 0.6, 3.4)

  scene.add(new THREE.HemisphereLight(0xffffff, 0x6b7a68, 1.1))
  const key = new THREE.DirectionalLight(0xffffff, 1.5)
  key.position.set(3, 5, 4)
  scene.add(key)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.enablePan = false
  controls.minDistance = 1.8
  controls.maxDistance = 7

  pivot = new THREE.Group()
  scene.add(pivot)

  new GLTFLoader().load(props.src, (gltf) => {
    if (disposed) return
    pivot.add(applyMode(gltf.scene, props.mode, props.sectors))
  })

  const clock = new THREE.Clock()
  const loop = () => {
    raf = requestAnimationFrame(loop)
    if (props.autoRotate) pivot.rotation.y += clock.getDelta() * 0.4
    else clock.getDelta()
    controls.update()
    renderer.render(scene, camera)
  }
  loop()

  resizeObserver = new ResizeObserver(() => {
    if (!renderer) return
    const w = el.clientWidth, h = el.clientHeight
    if (!w || !h) return
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
  })
  resizeObserver.observe(el)
}

function rebuild() {
  if (!pivot) return
  for (let i = pivot.children.length - 1; i >= 0; i--) pivot.remove(pivot.children[i])
  pivot.rotation.set(0, 0, 0)
  new GLTFLoader().load(props.src, (gltf) => {
    if (disposed) return
    pivot.add(applyMode(gltf.scene, props.mode, props.sectors))
  })
}

onMounted(init)
watch(() => props.mode, rebuild)

onBeforeUnmount(() => {
  disposed = true
  if (raf) cancelAnimationFrame(raf)
  if (resizeObserver) resizeObserver.disconnect()
  if (controls) controls.dispose()
  if (renderer) {
    renderer.dispose()
    renderer.domElement?.remove()
  }
  renderer = scene = camera = controls = pivot = null
})
</script>

<template>
  <div ref="host" class="model3d nodrag nopan" />
</template>

<style scoped>
.model3d {
  width: 100%;
  height: 100%;
  min-height: 180px;
  position: relative;
}
.model3d :deep(canvas) {
  display: block;
  width: 100% !important;
  height: 100% !important;
  border-radius: inherit;
  cursor: grab;
}
.model3d :deep(canvas:active) { cursor: grabbing; }
</style>
