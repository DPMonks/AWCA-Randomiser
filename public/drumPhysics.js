export const DRUM_RADIUS = 1.42;
export const BALL_RADIUS = 0.13;
export const VISUAL_RADIUS = 0.18;
export const CONTAIN_LIMIT = DRUM_RADIUS - VISUAL_RADIUS;
export const RESTITUTION = 0.9;
export const SUBSTEPS = 3;
export const IDLE_SPEED = 4.6;
export const DRAW_SPEED = 7.2;

export function containInPlace(pos, vel, limit = CONTAIN_LIMIT, restitution = RESTITUTION) {
  const distance = Math.hypot(pos.x, pos.y, pos.z);
  if (!(distance > limit) || distance === 0) return false;
  const nx = pos.x / distance;
  const ny = pos.y / distance;
  const nz = pos.z / distance;
  pos.x = nx * limit;
  pos.y = ny * limit;
  pos.z = nz * limit;
  const outward = vel.x * nx + vel.y * ny + vel.z * nz;
  if (outward > 0) {
    const bounce = (1 + restitution) * outward;
    vel.x -= bounce * nx;
    vel.y -= bounce * ny;
    vel.z -= bounce * nz;
  }
  return true;
}

function capSpeed(vel, maxSpeed) {
  const speed = Math.hypot(vel.x, vel.y, vel.z);
  if (speed <= maxSpeed || speed === 0) return;
  const scale = maxSpeed / speed;
  vel.x *= scale;
  vel.y *= scale;
  vel.z *= scale;
}

export function addKick(vel, energy, rand) {
  const kick = energy > 1.35 ? 2.7 : 1.35;
  vel.x += (rand() - 0.5) * kick * 2;
  vel.y += (0.45 + rand() * 0.7) * kick;
  vel.z += (rand() - 0.5) * kick * 2;
}

export function stirInPlace(pos, vel, dt, energy) {
  const bottom = Math.max(0, -0.05 - pos.y) / CONTAIN_LIMIT;
  const jet = 34 * energy * bottom * bottom;
  vel.y += jet * dt;
  vel.y -= 3.6 * dt;
  const swirl = 2.6 * energy;
  vel.x += -pos.z * swirl * dt;
  vel.z += pos.x * swirl * dt;
  const damp = Math.exp((energy < 0.6 ? -1.8 : -0.12) * dt);
  vel.x *= damp;
  vel.y *= damp;
  vel.z *= damp;
  capSpeed(vel, energy > 1.35 ? DRAW_SPEED : IDLE_SPEED);
}

export function simulateSteps({
  count = 40,
  steps = 360,
  dt = 1 / 60,
  energy = 1,
  rand = Math.random,
  speed = 9,
} = {}) {
  const balls = [];
  for (let index = 0; index < count; index += 1) {
    const angle = index * 2.399963;
    const ball = {
      x: Math.cos(angle) * 0.15,
      y: -0.95,
      z: Math.sin(angle) * 0.15,
      vx: (rand() - 0.5) * speed,
      vy: rand() * speed,
      vz: (rand() - 0.5) * speed,
      nextKick: 0,
    };
    ball.vel = {
      get x() { return ball.vx; },
      set x(value) { ball.vx = value; },
      get y() { return ball.vy; },
      set y(value) { ball.vy = value; },
      get z() { return ball.vz; },
      set z(value) { ball.vz = value; },
    };
    balls.push(ball);
  }
  const sub = dt / SUBSTEPS;
  let time = 0;
  let minY = Infinity;
  let maxY = -Infinity;
  let maxRadius = 0;
  for (let step = 0; step < steps; step += 1) {
    for (let part = 0; part < SUBSTEPS; part += 1) {
      for (const ball of balls) {
        if (time >= ball.nextKick) {
          addKick(ball.vel, energy, rand);
          const wait = energy > 1.35 ? 0.12 + rand() * 0.28 : 0.28 + rand() * 0.7;
          ball.nextKick = time + wait;
        }
        stirInPlace(ball, ball.vel, sub, energy);
        ball.x += ball.vx * sub;
        ball.y += ball.vy * sub;
        ball.z += ball.vz * sub;
        containInPlace(ball, ball.vel);
        if (step > 90) {
          const radius = Math.hypot(ball.x, ball.y, ball.z);
          if (radius > maxRadius) maxRadius = radius;
          if (ball.y < minY) minY = ball.y;
          if (ball.y > maxY) maxY = ball.y;
        }
      }
      time += sub;
    }
  }
  return { balls, minY, maxY, maxRadius };
}
