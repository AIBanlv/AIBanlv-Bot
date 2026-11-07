// iOS 2e75b5f avatarHeadPoseScript: bind-local Euler offsets and body-follow shares.
export const PRESENTATION_ROTATION_GAINS = Object.freeze([0.23, 0.30, 0.20]);
const HEAD = /^(head|headfinal|mixamorighead|ccbasehead|bip001head)$/;
const NECK = /^(neck|neck01|neck02|neckupper|necklower|mixamorigneck|ccbasenecktwist01|ccbasenecktwist02|bip001neck)$/;
const TORSO = /^(spine|spine0?[1-4]|chest|upperchest|torso|mixamorigspine[0-4]?|ccbasespine0?[1-4]|bip001spine[0-4]?)$/;
const SHOULDER = /^(leftshoulder|rightshoulder|shoulderl|shoulderr|lshoulder|rshoulder|leftclavicle|rightclavicle|claviclel|clavicler|lclavicle|rclavicle|ccbaselclavicle|ccbaserclavicle|mixamorigleftshoulder|mixamorigrightshoulder|bip001lclavicle|bip001rclavicle)$/;
const COMPONENTS = ['pitch', 'yaw', 'roll', 'gazeX', 'gazeY', 'depth'];

export function isOwnedPresentationPose(pose) {
  return pose?.version === 1 && pose.owned === true
    && COMPONENTS.every((key) => Number.isFinite(pose[key]) && Math.abs(pose[key]) <= 1);
}

export function presentationBoneBindings(names = []) {
  const roles = names.map((value) => {
    const name = String(value || '').split(/[:|/]/).pop().toLowerCase().replace(/[_. -]/g, '');
    return HEAD.test(name) ? 'head' : NECK.test(name) ? 'neck'
      : TORSO.test(name) ? 'torso' : SHOULDER.test(name) ? 'shoulder' : null;
  });
  const head = roles.indexOf('head');
  if (head < 0) return [];
  const necks = roles.filter((role) => role === 'neck').length;
  const torsos = roles.filter((role) => role === 'torso').length;
  return roles.flatMap((role, index) => {
    if (!role || (role === 'head' && index !== head)) return [];
    const share = role === 'head' ? (necks ? (torsos ? 0.62 : 0.7) : (torsos ? 0.85 : 1))
      : role === 'neck' ? (torsos ? 0.23 : 0.3) / necks
        : role === 'torso' ? 0.15 / torsos : 0.04;
    const axis = role === 'torso' ? [0.55, 1, 0.7] : role === 'shoulder' ? [0.2, 0.55, 0.4] : [1, 1, 1];
    return [{ index, role, stabilize: role === 'head' || role === 'neck',
      gains: axis.map((weight, i) => weight * share * PRESENTATION_ROTATION_GAINS[i]) }];
  });
}

function determinant(m, b) {
  return m[b] * (m[b + 5] * m[b + 10] - m[b + 9] * m[b + 6])
    - m[b + 4] * (m[b + 1] * m[b + 10] - m[b + 9] * m[b + 2])
    + m[b + 8] * (m[b + 1] * m[b + 6] - m[b + 5] * m[b + 2]);
}

function inverse(m, b = 0) {
  const det = determinant(m, b);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const a = m[b], c = m[b + 4], d = m[b + 8], e = m[b + 1], f = m[b + 5];
  const g = m[b + 9], h = m[b + 2], i = m[b + 6], j = m[b + 10];
  const out = new Float64Array([
    (f * j - g * i) / det, (g * h - e * j) / det, (e * i - f * h) / det, 0,
    (d * i - c * j) / det, (a * j - d * h) / det, (c * h - a * i) / det, 0,
    (c * g - d * f) / det, (d * e - a * g) / det, (a * f - c * e) / det, 0, 0, 0, 0, 1,
  ]);
  for (let row = 0; row < 3; row++) {
    out[12 + row] = -(out[row] * m[b + 12] + out[4 + row] * m[b + 13] + out[8 + row] * m[b + 14]);
  }
  return out;
}

function multiply(a, b) {
  const out = new Float64Array(16);
  for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) {
    for (let k = 0; k < 4; k++) out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
  }
  return out;
}

function eulerXYZ(m, b, out) {
  const sx = (Math.hypot(m[b], m[b + 1], m[b + 2]) || 1) * (determinant(m, b) < 0 ? -1 : 1);
  const sy = Math.hypot(m[b + 4], m[b + 5], m[b + 6]) || 1;
  const sz = Math.hypot(m[b + 8], m[b + 9], m[b + 10]) || 1;
  const sineY = Math.max(-1, Math.min(1, m[b + 8] / sz));
  out[1] = Math.asin(sineY);
  out[0] = Math.abs(sineY) < 0.9999999 ? Math.atan2(-m[b + 9] / sz, m[b + 10] / sz)
    : Math.atan2(m[b + 6] / sy, m[b + 5] / sy);
  out[2] = Math.abs(sineY) < 0.9999999 ? Math.atan2(-m[b + 4] / sy, m[b] / sx) : 0;
  return out;
}

function writeRotation(m, b, angles) {
  const sx = (Math.hypot(m[b], m[b + 1], m[b + 2]) || 1) * (determinant(m, b) < 0 ? -1 : 1);
  const sy = Math.hypot(m[b + 4], m[b + 5], m[b + 6]) || 1;
  const sz = Math.hypot(m[b + 8], m[b + 9], m[b + 10]) || 1;
  const x = angles[0], y = angles[1], z = angles[2];
  const a = Math.cos(x), s = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  m[b] = c * e * sx; m[b + 1] = (a * f + s * d * e) * sx; m[b + 2] = (s * f - a * d * e) * sx;
  m[b + 4] = -c * f * sy; m[b + 5] = (a * e - s * d * f) * sy; m[b + 6] = (s * e + a * d * f) * sy;
  m[b + 8] = d * sz; m[b + 9] = -s * c * sz; m[b + 10] = a * c * sz;
}

export class SkeletonPresentationPose {
  constructor(skeleton) {
    this.output = new Float32Array(skeleton.localTransforms.length);
    this.angles = new Float64Array(3);
    this.bindings = presentationBoneBindings(skeleton.names || []).map((binding) => {
      const b = binding.index * 16, parent = skeleton.parents[binding.index];
      const global = inverse(skeleton.inverseBindMatrices, b);
      const parentInverse = parent >= 0 ? skeleton.inverseBindMatrices.subarray(parent * 16, parent * 16 + 16)
        : skeleton.rootTransforms ? inverse(skeleton.rootTransforms, b) : null;
      const local = global ? (parentInverse ? multiply(parentInverse, global) : global)
        : skeleton.localTransforms.subarray(b, b + 16);
      return { ...binding, rest: eulerXYZ(local, 0, new Float64Array(3)) };
    });
  }

  apply(locals, pose) {
    if (!this.bindings.length || !isOwnedPresentationPose(pose)) return locals;
    this.output.set(locals);
    for (const binding of this.bindings) {
      const b = binding.index * 16;
      if (binding.stabilize) this.angles.set(binding.rest);
      else eulerXYZ(locals, b, this.angles);
      this.angles[0] += pose.pitch * binding.gains[0];
      this.angles[1] += pose.yaw * binding.gains[1];
      this.angles[2] += pose.roll * binding.gains[2];
      writeRotation(this.output, b, this.angles);
    }
    return this.output;
  }
}
import { normalizeJointWeights } from './skeleton-math.js';


// Normalize once, not on every native presentation. The hot path reuses output.
export function createPresentationSkinner(skeleton) {
  const joints = skeleton.vertexJoints;
  const weights = normalizeJointWeights(skeleton.vertexWeights);
  return (centers, matrices, output) => {
    for (let vertex = 0; vertex < centers.length / 3; vertex++) {
      const p = vertex * 3, q = vertex * 4;
      const x = centers[p], y = centers[p + 1], z = centers[p + 2];
      let ox = 0, oy = 0, oz = 0, total = 0;
      for (let slot = q; slot < q + 4; slot++) {
        const weight = weights[slot], b = joints[slot] * 16;
        if (!weight || b + 15 >= matrices.length) continue;
        ox += weight * (matrices[b] * x + matrices[b + 4] * y + matrices[b + 8] * z + matrices[b + 12]);
        oy += weight * (matrices[b + 1] * x + matrices[b + 5] * y + matrices[b + 9] * z + matrices[b + 13]);
        oz += weight * (matrices[b + 2] * x + matrices[b + 6] * y + matrices[b + 10] * z + matrices[b + 14]);
        total += weight;
      }
      output[p] = total > 1e-8 ? ox : x;
      output[p + 1] = total > 1e-8 ? oy : y;
      output[p + 2] = total > 1e-8 ? oz : z;
    }
    return output;
  };
}
