function multiplyMat4(left, leftOffset, right, rightOffset, output, offset) {
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      output[offset + column * 4 + row] = left[leftOffset + row] * right[rightOffset + column * 4]
        + left[leftOffset + 4 + row] * right[rightOffset + column * 4 + 1]
        + left[leftOffset + 8 + row] * right[rightOffset + column * 4 + 2]
        + left[leftOffset + 12 + row] * right[rightOffset + column * 4 + 3];
    }
  }
}

function overlaps(left, right) {
  return right != null && left.buffer === right.buffer
    && left.byteLength > 0 && right.byteLength > 0
    && left.byteOffset < right.byteOffset + right.byteLength
    && right.byteOffset < left.byteOffset + left.byteLength;
}

// Optional workspaces must have exact lengths and may not overlap any input
// (or each other). Disjoint views of a shared buffer are supported.
export function computeJointGlobalTransforms(localTransforms, parents, rootTransforms = null, output, visiting) {
  const count = Math.floor(localTransforms.length / 16);
  if (parents.length !== count) throw new Error('joint parent count must match local transform count');
  if (output === undefined) output = new Float32Array(count * 16);
  else {
    if (!(output instanceof Float32Array) || output.length !== count * 16) {
      throw new Error('joint output must be a Float32Array matching the transform count');
    }
    if (overlaps(output, localTransforms) || overlaps(output, parents) || overlaps(output, rootTransforms)) {
      throw new Error('joint output must not overlap inputs');
    }
  }
  if (visiting === undefined) visiting = new Uint8Array(count);
  else {
    if (!(visiting instanceof Uint8Array) || visiting.length !== count) {
      throw new Error('joint visiting must be a Uint8Array matching the joint count');
    }
    if (overlaps(visiting, localTransforms) || overlaps(visiting, parents)
      || overlaps(visiting, rootTransforms) || overlaps(visiting, output)) {
      throw new Error('joint visiting must not overlap inputs or output');
    }
    // Clear stale completed/active markers, including those left by a throw.
    visiting.fill(0);
  }
  const visit = (index) => {
    if (visiting[index] === 2) return;
    if (visiting[index] === 1) throw new Error('joint hierarchy contains a cycle');
    visiting[index] = 1;
    const parent = parents[index];
    const offset = index * 16;
    if (parent < 0) {
      if (rootTransforms) multiplyMat4(rootTransforms, offset, localTransforms, offset, output, offset);
      else for (let component = 0; component < 16; component += 1) output[offset + component] = localTransforms[offset + component];
    }
    else {
      if (parent >= count) throw new Error('joint parent index is out of range');
      visit(parent);
      multiplyMat4(output, parent * 16, localTransforms, offset, output, offset);
    }
    visiting[index] = 2;
  };
  for (let index = 0; index < count; index += 1) visit(index);
  return output;
}

// Omit output to preserve the allocating API; supplied output cannot alias inputs.
export function computeSkinningMatrices(globalTransforms, inverseBindMatrices, output) {
  if (globalTransforms.length !== inverseBindMatrices.length) throw new Error('global and inverse bind matrices must match');
  if (output === undefined) output = new Float32Array(globalTransforms.length);
  else {
    if (!(output instanceof Float32Array) || output.length !== globalTransforms.length) {
      throw new Error('skinning output must be a Float32Array matching the transform count');
    }
    if (overlaps(output, globalTransforms) || overlaps(output, inverseBindMatrices)) {
      throw new Error('skinning output must not overlap inputs');
    }
  }
  for (let index = 0; index < globalTransforms.length; index += 16) {
    multiplyMat4(
      globalTransforms,
      index,
      inverseBindMatrices,
      index,
      output,
      index,
    );
  }
  return output;
}

export function normalizeJointWeights(weights, influences = 4) {
  if (weights.length % influences !== 0) throw new Error('joint weights must contain complete influence tuples');
  const output = new Float32Array(weights.length);
  for (let offset = 0; offset < weights.length; offset += influences) {
    let total = 0;
    for (let influence = 0; influence < influences; influence += 1) {
      const value = Number(weights[offset + influence]);
      output[offset + influence] = Number.isFinite(value) && value > 0 ? value : 0;
      total += output[offset + influence];
    }
    if (total > 1e-8) for (let influence = 0; influence < influences; influence += 1) output[offset + influence] /= total;
  }
  return output;
}

export function selectRigidSkeletonJointIndex(skeleton, jointName = 'head') {
  const names = Array.isArray(skeleton?.names) ? skeleton.names : [];
  const index = names.findIndex((name) => String(name).toLowerCase() === jointName.toLowerCase());
  return index >= 0 ? index : 0;
}

export function skinGaussianCenters(bindCenters, vertexJoints, vertexWeights, skinMatrices, output = new Float32Array(bindCenters.length)) {
  if (bindCenters.length % 3 !== 0 || vertexJoints.length !== (bindCenters.length / 3) * 4 || vertexWeights.length !== vertexJoints.length) {
    throw new Error('Gaussian skinning arrays have incompatible lengths');
  }
  const normalizedWeights = normalizeJointWeights(vertexWeights);
  for (let vertex = 0; vertex < bindCenters.length / 3; vertex += 1) {
    const positionOffset = vertex * 3;
    const influenceOffset = vertex * 4;
    let x = 0; let y = 0; let z = 0; let total = 0;
    for (let influence = 0; influence < 4; influence += 1) {
      const weight = normalizedWeights[influenceOffset + influence];
      const joint = vertexJoints[influenceOffset + influence];
      const matrixOffset = joint * 16;
      if (!weight || matrixOffset + 15 >= skinMatrices.length) continue;
      const px = bindCenters[positionOffset]; const py = bindCenters[positionOffset + 1]; const pz = bindCenters[positionOffset + 2];
      x += weight * (skinMatrices[matrixOffset] * px + skinMatrices[matrixOffset + 4] * py + skinMatrices[matrixOffset + 8] * pz + skinMatrices[matrixOffset + 12]);
      y += weight * (skinMatrices[matrixOffset + 1] * px + skinMatrices[matrixOffset + 5] * py + skinMatrices[matrixOffset + 9] * pz + skinMatrices[matrixOffset + 13]);
      z += weight * (skinMatrices[matrixOffset + 2] * px + skinMatrices[matrixOffset + 6] * py + skinMatrices[matrixOffset + 10] * pz + skinMatrices[matrixOffset + 14]);
      total += weight;
    }
    if (total > 1e-8) { output[positionOffset] = x; output[positionOffset + 1] = y; output[positionOffset + 2] = z; }
    else output.set(bindCenters.subarray(positionOffset, positionOffset + 3), positionOffset);
  }
  return output;
}

export function transformGaussianCentersByJoint(
  bindCenters,
  skinMatrices,
  jointIndex,
  output = new Float32Array(bindCenters.length),
) {
  if (bindCenters.length % 3 !== 0 || output.length !== bindCenters.length) {
    throw new Error('Rigid Gaussian transform arrays have incompatible lengths');
  }
  const matrixOffset = Math.trunc(jointIndex) * 16;
  if (matrixOffset < 0 || matrixOffset + 15 >= skinMatrices.length) {
    throw new Error('Rigid Gaussian transform joint is out of range');
  }
  const m00 = skinMatrices[matrixOffset]; const m01 = skinMatrices[matrixOffset + 4]; const m02 = skinMatrices[matrixOffset + 8]; const tx = skinMatrices[matrixOffset + 12];
  const m10 = skinMatrices[matrixOffset + 1]; const m11 = skinMatrices[matrixOffset + 5]; const m12 = skinMatrices[matrixOffset + 9]; const ty = skinMatrices[matrixOffset + 13];
  const m20 = skinMatrices[matrixOffset + 2]; const m21 = skinMatrices[matrixOffset + 6]; const m22 = skinMatrices[matrixOffset + 10]; const tz = skinMatrices[matrixOffset + 14];
  for (let offset = 0; offset < bindCenters.length; offset += 3) {
    const x = bindCenters[offset]; const y = bindCenters[offset + 1]; const z = bindCenters[offset + 2];
    output[offset] = m00 * x + m01 * y + m02 * z + tx;
    output[offset + 1] = m10 * x + m11 * y + m12 * z + ty;
    output[offset + 2] = m20 * x + m21 * y + m22 * z + tz;
  }
  return output;
}

export function transformGaussianCentersByRelativeJoint(
  bindCenters,
  skinMatrices,
  referenceSkinMatrices,
  jointIndex,
  output = new Float32Array(bindCenters.length),
) {
  if (bindCenters.length % 3 !== 0 || output.length !== bindCenters.length) {
    throw new Error('Rigid Gaussian transform arrays have incompatible lengths');
  }
  const matrixOffset = Math.trunc(jointIndex) * 16;
  if (
    matrixOffset < 0
    || matrixOffset + 15 >= skinMatrices.length
    || matrixOffset + 15 >= referenceSkinMatrices.length
  ) {
    throw new Error('Rigid Gaussian transform joint is out of range');
  }

  const r00 = referenceSkinMatrices[matrixOffset]; const r01 = referenceSkinMatrices[matrixOffset + 4]; const r02 = referenceSkinMatrices[matrixOffset + 8];
  const r10 = referenceSkinMatrices[matrixOffset + 1]; const r11 = referenceSkinMatrices[matrixOffset + 5]; const r12 = referenceSkinMatrices[matrixOffset + 9];
  const r20 = referenceSkinMatrices[matrixOffset + 2]; const r21 = referenceSkinMatrices[matrixOffset + 6]; const r22 = referenceSkinMatrices[matrixOffset + 10];
  const determinant = r00 * (r11 * r22 - r12 * r21)
    - r01 * (r10 * r22 - r12 * r20)
    + r02 * (r10 * r21 - r11 * r20);
  if (Math.abs(determinant) <= 1e-8) throw new Error('Rigid Gaussian reference transform is singular');
  const inverseDeterminant = 1 / determinant;
  const i00 = (r11 * r22 - r12 * r21) * inverseDeterminant;
  const i01 = (r02 * r21 - r01 * r22) * inverseDeterminant;
  const i02 = (r01 * r12 - r02 * r11) * inverseDeterminant;
  const i10 = (r12 * r20 - r10 * r22) * inverseDeterminant;
  const i11 = (r00 * r22 - r02 * r20) * inverseDeterminant;
  const i12 = (r02 * r10 - r00 * r12) * inverseDeterminant;
  const i20 = (r10 * r21 - r11 * r20) * inverseDeterminant;
  const i21 = (r01 * r20 - r00 * r21) * inverseDeterminant;
  const i22 = (r00 * r11 - r01 * r10) * inverseDeterminant;
  const rtx = referenceSkinMatrices[matrixOffset + 12];
  const rty = referenceSkinMatrices[matrixOffset + 13];
  const rtz = referenceSkinMatrices[matrixOffset + 14];
  const itx = -(i00 * rtx + i01 * rty + i02 * rtz);
  const ity = -(i10 * rtx + i11 * rty + i12 * rtz);
  const itz = -(i20 * rtx + i21 * rty + i22 * rtz);

  const c00 = skinMatrices[matrixOffset]; const c01 = skinMatrices[matrixOffset + 4]; const c02 = skinMatrices[matrixOffset + 8];
  const c10 = skinMatrices[matrixOffset + 1]; const c11 = skinMatrices[matrixOffset + 5]; const c12 = skinMatrices[matrixOffset + 9];
  const c20 = skinMatrices[matrixOffset + 2]; const c21 = skinMatrices[matrixOffset + 6]; const c22 = skinMatrices[matrixOffset + 10];
  const m00 = c00 * i00 + c01 * i10 + c02 * i20;
  const m01 = c00 * i01 + c01 * i11 + c02 * i21;
  const m02 = c00 * i02 + c01 * i12 + c02 * i22;
  const m10 = c10 * i00 + c11 * i10 + c12 * i20;
  const m11 = c10 * i01 + c11 * i11 + c12 * i21;
  const m12 = c10 * i02 + c11 * i12 + c12 * i22;
  const m20 = c20 * i00 + c21 * i10 + c22 * i20;
  const m21 = c20 * i01 + c21 * i11 + c22 * i21;
  const m22 = c20 * i02 + c21 * i12 + c22 * i22;
  const tx = c00 * itx + c01 * ity + c02 * itz + skinMatrices[matrixOffset + 12];
  const ty = c10 * itx + c11 * ity + c12 * itz + skinMatrices[matrixOffset + 13];
  const tz = c20 * itx + c21 * ity + c22 * itz + skinMatrices[matrixOffset + 14];

  for (let offset = 0; offset < bindCenters.length; offset += 3) {
    const x = bindCenters[offset]; const y = bindCenters[offset + 1]; const z = bindCenters[offset + 2];
    output[offset] = m00 * x + m01 * y + m02 * z + tx;
    output[offset + 1] = m10 * x + m11 * y + m12 * z + ty;
    output[offset + 2] = m20 * x + m21 * y + m22 * z + tz;
  }
  return output;
}

export function skinGaussianCovariances(bindCovariances, vertexJoints, vertexWeights, skinMatrices, output = new Float32Array(bindCovariances.length)) {
  if (bindCovariances.length % 6 !== 0 || vertexJoints.length !== (bindCovariances.length / 6) * 4 || vertexWeights.length !== vertexJoints.length) {
    throw new Error('Gaussian covariance skinning arrays have incompatible lengths');
  }
  const normalizedWeights = normalizeJointWeights(vertexWeights);
  for (let vertex = 0; vertex < bindCovariances.length / 6; vertex += 1) {
    const covarianceOffset = vertex * 6;
    const blended = new Float64Array(9);
    const influenceOffset = vertex * 4;
    let total = 0;
    for (let influence = 0; influence < 4; influence += 1) {
      const weight = normalizedWeights[influenceOffset + influence];
      const matrixOffset = vertexJoints[influenceOffset + influence] * 16;
      if (!weight || matrixOffset + 15 >= skinMatrices.length) continue;
      for (let component = 0; component < 9; component += 1) blended[component] += weight * skinMatrices[matrixOffset + (component % 3) + Math.floor(component / 3) * 4];
      total += weight;
    }
    if (total <= 1e-8) { output.set(bindCovariances.subarray(covarianceOffset, covarianceOffset + 6), covarianceOffset); continue; }
    const a00 = blended[0], a01 = blended[3], a02 = blended[6];
    const a10 = blended[1], a11 = blended[4], a12 = blended[7];
    const a20 = blended[2], a21 = blended[5], a22 = blended[8];
    const c00 = bindCovariances[covarianceOffset], c01 = bindCovariances[covarianceOffset + 1], c02 = bindCovariances[covarianceOffset + 2];
    const c11 = bindCovariances[covarianceOffset + 3], c12 = bindCovariances[covarianceOffset + 4], c22 = bindCovariances[covarianceOffset + 5];
    const multiply = (ax, ay, az, bx, by, bz) => ax * (c00 * bx + c01 * by + c02 * bz) + ay * (c01 * bx + c11 * by + c12 * bz) + az * (c02 * bx + c12 * by + c22 * bz);
    output[covarianceOffset] = multiply(a00, a01, a02, a00, a01, a02);
    output[covarianceOffset + 1] = multiply(a00, a01, a02, a10, a11, a12);
    output[covarianceOffset + 2] = multiply(a00, a01, a02, a20, a21, a22);
    output[covarianceOffset + 3] = multiply(a10, a11, a12, a10, a11, a12);
    output[covarianceOffset + 4] = multiply(a10, a11, a12, a20, a21, a22);
    output[covarianceOffset + 5] = multiply(a20, a21, a22, a20, a21, a22);
  }
  return output;
}
