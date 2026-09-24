import * as THREE from "three";
import { Body, SAPBroadphase, Sphere, Vec3, World } from "cannon-es";

const MAX_BALLS = 100;
const BALL_RADIUS = 0.13;
const DRUM_RADIUS = 1.42;

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function colorFor(ref) {
  let hash = 0;
  for (let i = 0; i < ref.length; i += 1) hash = (hash * 33 + ref.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue} 72% 46%)`;
}

function labelTexture(text, color, lines) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 256, 256);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(128, 128, 120, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const rows = lines || [text];
  ctx.font = rows.length > 1 ? "700 42px sans-serif" : "700 48px sans-serif";
  const start = 128 - (rows.length - 1) * 28;
  rows.forEach((row, index) => {
    ctx.fillText(row, 128, start + index * 56);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function spawnPoint(index) {
  const layer = Math.floor(index / 8);
  const angle = index * 2.399963;
  const ring = 0.22 + (index % 4) * 0.22;
  return new Vec3(Math.cos(angle) * ring, -0.85 + layer * 0.22, Math.sin(angle) * ring);
}

export function mountDrum(canvas, hooks = {}) {
  const reduced = reducedMotion();
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0x071425, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 40);
  const frameTarget = new THREE.Vector3(0, -0.12, 0);

  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  const key = new THREE.DirectionalLight(0xfff4dd, 1.15);
  key.position.set(3, 4, 5);
  const rim = new THREE.DirectionalLight(0x8ecbff, 0.8);
  rim.position.set(-4, 1, -3);
  const fill = new THREE.PointLight(0xffffff, 0.45, 8);
  fill.position.set(0, 0.2, 0.4);
  scene.add(ambient, key, rim, fill);

  const drum = new THREE.Group();
  scene.add(drum);
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(DRUM_RADIUS, 48, 36),
    new THREE.MeshPhongMaterial({
      color: 0xc6ecff,
      transparent: true,
      opacity: 0.16,
      shininess: 120,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  const rimGlass = new THREE.Mesh(
    new THREE.SphereGeometry(DRUM_RADIUS + 0.02, 48, 36),
    new THREE.MeshBasicMaterial({
      color: 0xe7f7ff,
      transparent: true,
      opacity: 0.28,
      side: THREE.BackSide,
    })
  );
  const hole = new THREE.Mesh(
    new THREE.CircleGeometry(0.2, 28),
    new THREE.MeshBasicMaterial({ color: 0x071425, side: THREE.DoubleSide })
  );
  hole.position.set(0, -DRUM_RADIUS + 0.16, 0.18);
  hole.rotation.x = Math.PI / 2;
  const chute = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.26, 1.55, 20, 1, true),
    new THREE.MeshPhongMaterial({
      color: 0xd5eeff,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  chute.position.set(0.05, -1.15, 1.15);
  chute.rotation.x = Math.PI / 2.35;
  const stand = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.7, 0.18, 24),
    new THREE.MeshPhongMaterial({ color: 0x16324f, shininess: 30 })
  );
  stand.position.set(0, -1.58, 0);
  drum.add(shell, rimGlass);
  scene.add(chute, stand, hole);

  const world = new World({ gravity: new Vec3(0, -3.2, 0) });
  world.broadphase = new SAPBroadphase(world);
  world.allowSleep = false;
  world.solver.iterations = 6;

  const balls = new Map();
  const ballGeo = new THREE.SphereGeometry(BALL_RADIUS, 20, 16);
  let spin = 0.35;
  let phase = "idle";
  let phaseUntil = 0;
  let release = null;
  let releaseStart = 0;
  let releaseFrom = null;
  let shownRefs = [];
  let resizeObserver;

  function contain(body) {
    const distance = body.position.length();
    const limit = DRUM_RADIUS - BALL_RADIUS - 0.04;
    if (distance <= limit || distance === 0) return;
    const nx = body.position.x / distance;
    const ny = body.position.y / distance;
    const nz = body.position.z / distance;
    body.position.set(nx * limit, ny * limit, nz * limit);
    const outward = body.velocity.x * nx + body.velocity.y * ny + body.velocity.z * nz;
    if (outward > 0) {
      body.velocity.x -= 1.7 * outward * nx;
      body.velocity.y -= 1.7 * outward * ny;
      body.velocity.z -= 1.7 * outward * nz;
    }
  }

  function makeBall(ref, index) {
    const color = colorFor(ref);
    const material = new THREE.MeshPhongMaterial({ color, shininess: 40 });
    const mesh = new THREE.Mesh(ballGeo, material);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: labelTexture(ref, color), transparent: true, depthWrite: false })
    );
    sprite.scale.set(0.46, 0.46, 1);
    sprite.position.z = BALL_RADIUS + 0.01;
    const group = new THREE.Group();
    group.add(mesh, sprite);
    group.scale.setScalar(reduced ? 1 : 0.01);
    scene.add(group);
    const point = spawnPoint(index);
    const body = new Body({
      mass: 1,
      shape: new Sphere(BALL_RADIUS),
      position: point,
      linearDamping: 0.18,
      angularDamping: 0.2,
    });
    body.velocity.set((Math.random() - 0.5) * 1.4, Math.random() * 1.2, (Math.random() - 0.5) * 1.4);
    world.addBody(body);
    const ball = { ref, group, mesh, sprite, body, appear: performance.now(), removeAt: 0, texture: sprite.material.map };
    balls.set(ref, ball);
    return ball;
  }

  function retire(ref) {
    const ball = balls.get(ref);
    if (!ball || ball.removeAt) return;
    ball.removeAt = performance.now();
  }

  function disposeBall(ball) {
    world.removeBody(ball.body);
    scene.remove(ball.group);
    ball.mesh.material.dispose();
    ball.sprite.material.map?.dispose();
    ball.sprite.material.dispose();
    balls.delete(ball.ref);
  }

  function setEntries(refs) {
    const unique = [];
    const seen = new Set();
    for (const value of refs || []) {
      const ref = String(value || "").trim().toUpperCase();
      if (!/^[0-9A-F]{6}$/.test(ref) || seen.has(ref)) continue;
      seen.add(ref);
      unique.push(ref);
    }
    const next = unique.slice(0, MAX_BALLS);
    const nextSet = new Set(next);
    for (const ref of balls.keys()) {
      if (!nextSet.has(ref)) retire(ref);
    }
    next.forEach((ref, index) => {
      if (!balls.has(ref)) makeBall(ref, index);
    });
    shownRefs = next;
    hooks.onOverflow?.(Math.max(0, unique.length - next.length));
    if (reduced) render();
  }

  function faceCamera(ball) {
    ball.group.quaternion.identity();
    ball.group.lookAt(camera.position);
  }

  function playDraw({ entryRef, label }) {
    if (phase !== "idle") return;
    const ref = String(entryRef || "").trim().toUpperCase();
    let ball = balls.get(ref) || null;
    if (!ball) {
      const first = balls.values().next();
      ball = first.done ? null : first.value;
    }
    if (reduced || !ball) {
      phase = "reveal";
      hooks.onReveal?.(label || "");
      window.setTimeout(() => {
        phase = "idle";
        hooks.onSettle?.();
      }, 1600);
      return;
    }
    phase = "spin";
    spin = 2.4;
    phaseUntil = performance.now() + 1300;
    release = { ball, label: label || `Entry ${ball.ref}`, ref: ball.ref };
  }

  function beginDrop(now) {
    phase = "drop";
    releaseStart = now;
    const ball = release.ball;
    world.removeBody(ball.body);
    releaseFrom = ball.group.position.clone();
    const revealLines = String(release.label).split(" - ");
    const fresh = labelTexture(release.label, colorFor(ball.ref), revealLines.length > 1 ? revealLines : [release.label]);
    ball.sprite.material.map = fresh;
    ball.texture.dispose();
    ball.texture = fresh;
  }

  function dropPosition(t) {
    const from = releaseFrom;
    const hatch = new THREE.Vector3(0, -1.15, 0.28);
    const mouth = new THREE.Vector3(0.02, -0.42, 1.72);
    if (t < 0.42) {
      const local = t / 0.42;
      return new THREE.Vector3(
        from.x * (1 - local) + hatch.x * local,
        from.y * (1 - local) + hatch.y * local,
        from.z * (1 - local) + hatch.z * local
      );
    }
    const local = (t - 0.42) / 0.58;
    const u = 1 - local;
    const lift = new THREE.Vector3(0, -0.55, 1.05);
    return new THREE.Vector3(
      u * u * hatch.x + 2 * u * local * lift.x + local * local * mouth.x,
      u * u * hatch.y + 2 * u * local * lift.y + local * local * mouth.y,
      u * u * hatch.z + 2 * u * local * lift.z + local * local * mouth.z
    );
  }

  function frameCamera() {
    const aspect = Math.max(camera.aspect, 0.25);
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const pad = 1.2;
    const distY = (1.9 * pad) / Math.tan(vFov / 2);
    const distX = (1.72 * pad) / Math.tan(hFov / 2);
    camera.position.set(0, frameTarget.y + 0.26, Math.max(distX, distY));
    camera.lookAt(frameTarget);
  }

  function resize() {
    const width = canvas.clientWidth || 640;
    const height = canvas.clientHeight || 480;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    frameCamera();
  }

  function render() {
    renderer.render(scene, camera);
  }

  function animate(now) {
    requestAnimationFrame(animate);
    const angle = now * 0.001 * spin;
    if (!reduced && phase !== "drop" && phase !== "reveal") {
      world.gravity.set(Math.sin(angle) * 2.1, -3.4, Math.cos(angle) * 2.1);
      world.step(1 / 60);
      drum.rotation.y += 0.004 * spin;
      drum.rotation.z = Math.sin(now * 0.0004) * 0.08;
    }
    if (phase === "spin" && now >= phaseUntil) beginDrop(now);
    if (phase === "drop" && release) {
      const t = Math.min(1, (now - releaseStart) / 2100);
      const eased = t * t * (3 - 2 * t);
      const point = dropPosition(eased);
      release.ball.group.position.copy(point);
      release.ball.group.scale.setScalar(1 + eased * 0.5);
      faceCamera(release.ball);
      if (t >= 1 && phase === "drop") {
        phase = "reveal";
        phaseUntil = now + 2800;
        hooks.onReveal?.(release.label);
      }
    }
    if (phase === "reveal" && now >= phaseUntil) {
      phase = "idle";
      spin = 0.35;
      if (release) {
        disposeBall(release.ball);
        const ref = release.ref;
        if (shownRefs.includes(ref)) makeBall(ref, shownRefs.indexOf(ref));
        release = null;
      }
      hooks.onSettle?.();
    }
    const dim = phase === "idle" ? 1 : 0.45;
    ambient.intensity = 0.55 * dim;
    key.intensity = phase === "reveal" ? 1.4 : 1.15 * dim;

    const gone = [];
    for (const ball of balls.values()) {
      if (release && ball === release.ball && (phase === "drop" || phase === "reveal")) continue;
      if (!ball.removeAt && phase !== "drop" && phase !== "reveal") contain(ball.body);
      ball.group.position.copy(ball.body.position);
      ball.mesh.quaternion.copy(ball.body.quaternion);
      const age = now - ball.appear;
      let scale = Math.min(1, age / 420);
      if (ball.removeAt) {
        scale *= Math.max(0, 1 - (now - ball.removeAt) / 320);
        if (now - ball.removeAt > 320) gone.push(ball);
      }
      ball.group.scale.setScalar(Math.max(0.001, scale));
    }
    for (const ball of gone) disposeBall(ball);
    render();
  }

  resize();
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
  } else {
    window.addEventListener("resize", resize);
  }
  if (reduced) render();
  else requestAnimationFrame(animate);

  return {
    setEntries,
    playDraw,
    resize,
    get phase() {
      return phase;
    },
    get count() {
      return balls.size;
    },
  };
}

const canvas = document.getElementById("lotteryCanvas");
if (canvas) {
  try {
    window.AwcaDrum = mountDrum(canvas, {
      onOverflow(extra) {
        const note = document.getElementById("drum-more");
        if (!note) return;
        note.hidden = extra <= 0;
        note.textContent = extra > 0 ? `+${extra} more entries` : "";
      },
      onReveal(label) {
        window.dispatchEvent(new CustomEvent("awca-reveal", { detail: { label } }));
      },
      onSettle() {
        window.dispatchEvent(new Event("awca-reveal-end"));
      },
    });
    window.dispatchEvent(new Event("awca-drum-ready"));
  } catch (error) {
    console.error(error);
    window.dispatchEvent(new Event("awca-drum-failed"));
  }
}
