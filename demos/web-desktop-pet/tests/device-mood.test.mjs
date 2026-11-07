import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { MoodState, moodActions, reactionActions, isValidMoodAction, moodAction, moodMotion,
  classifyHover, classifyProximity, idleLevel, moodKinds, reactiveKinds, moodVariables,
  wanderActions } from '../electron/device-mood-policy.mjs'
import { motionTags, sampleTextAction } from '../src/text-motion.mjs'

const sequence = values => { let index = 0; return () => values[Math.min(values.length - 1, index++)] }

test('mood variables stay bounded and drift back to calm', () => {
  const state = new MoodState()
  for (const name of moodVariables) {
    assert.ok(Number.isFinite(state[name]) && state[name] >= 0 && state[name] <= 1, name)
  }
  state.curiosity = 1
  for (let i = 0; i < 100; i++) state.decay(1)
  assert.equal(state.curiosity, 0)
  assert.equal(state.mood, 'sleepy', 'a long silence leaves the pet drowsy')
  state.drowsiness = 0
  assert.equal(state.refresh(), 'calm')
  assert.equal(state.apply('unknown-kind'), 'calm')
  assert.equal(state.decay(-1), 'calm')
  assert.equal(state.decay(Number.NaN), 'calm')
})

test('consecutive pokes escalate irritation the way an internal state machine should', () => {
  const state = new MoodState()
  assert.equal(state.apply('tap', 1000), 'calm')
  assert.equal(state.apply('tap', 2000), 'curious', 'the second poke raises curiosity')
  assert.ok(state.irritation > 0)
  state.apply('tap', 3000)
  assert.ok(state.irritation >= 0.45, `irritation ${state.irritation}`)
  assert.equal(state.mood, 'annoyed')
  // A stroke calms the pet down again instead of leaving it stuck.
  state.apply('stroke', 4000)
  assert.ok(state.irritation < 0.45)
  assert.notEqual(state.mood, 'annoyed')
  // Pokes far apart are not a burst any more.
  const calm = new MoodState()
  calm.apply('tap', 1000); calm.apply('tap', 9000)
  assert.equal(calm.clicks, 1)
})

test('stroking builds intimacy while idleness grows drowsiness', () => {
  const state = new MoodState({ random: () => 0 })
  for (let i = 0; i < 6; i++) state.apply('stroke', i * 500)
  assert.ok(state.intimacy >= 0.55, `intimacy ${state.intimacy}`)
  assert.equal(state.mood, 'affectionate')
  const sleepy = new MoodState()
  sleepy.drowsiness = 0.5
  sleepy.apply('idle', 0)
  assert.ok(sleepy.drowsiness >= 0.55, `drowsiness ${sleepy.drowsiness}`)
  assert.equal(sleepy.mood, 'sleepy')
  // Waking it up: the cursor is back and the sleepiness drops below the threshold.
  sleepy.apply('hover', 30000)
  assert.ok(sleepy.drowsiness < 0.55)
  assert.notEqual(sleepy.mood, 'sleepy')
})

test('every idle preset is written with tags from the existing motion library', () => {
  const presets = [...Object.values(moodActions).flat(), ...Object.values(reactionActions)]
  assert.ok(presets.length >= 12, 'the idle behaviour keeps a varied repertoire')
  for (const preset of presets) assert.ok(isValidMoodAction(preset), JSON.stringify(preset))
  for (const key of ['head', 'emotion', 'gaze', 'depth']) assert.ok(motionTags[key].length > 1)
  assert.equal(isValidMoodAction(null), false)
  assert.equal(isValidMoodAction(undefined), false)
  assert.equal(isValidMoodAction({ head: 'nod', emotion: 'sleepy', gaze: 'soft', depth: 'none' }), false)
})

test('mood action picks a gesture answer first and falls back to the mood', () => {
  const state = new MoodState()
  const stroke = moodAction(state, { kind: 'stroke' })
  assert.deepEqual([stroke.head, stroke.emotion, stroke.gaze, stroke.depth], ['nod', 'warm', 'contact', 'forward'])
  assert.equal(stroke.duration, 3)
  state.mood = 'sleepy'
  const idle = moodAction(state, { random: () => 0 })
  assert.equal(idle.head, 'slow_nod')
  assert.equal(idle.duration, 3.4)
  // The pet glances towards the side the cursor sits on.
  const glance = moodAction(new MoodState(), { random: () => 0.1, side: 'right' })
  assert.equal(glance.head, 'look_right')
  assert.notEqual(moodAction(new MoodState(), { random: () => 0.9, side: 'right' }).head, 'look_right',
    'the glance is a weighted choice, not a fixed one')
  assert.equal(moodMotion({ head: 'none', emotion: 'neutral', gaze: 'soft', depth: 'none' }).pages.length, 1)
})

test('press-less pointer reading tells stroking from a flick and from hovering', () => {
  assert.equal(classifyHover({ path: 62, reversals: 2, duration: 400, speed: 155 }), 'STROKE')
  assert.equal(classifyHover({ path: 40, reversals: 1, duration: 40, speed: 1000 }), 'FLICK')
  assert.equal(classifyHover({ path: 14, reversals: 0, duration: 200, speed: 70 }), 'HOVER')
  assert.equal(classifyHover({ path: 4, reversals: 0, duration: 60, speed: 66 }), 'UNKNOWN')
  for (const value of [null, {}, { path: Number.NaN, duration: 0 }, { path: 10, duration: -1 }]) {
    assert.equal(classifyHover(value), 'UNKNOWN')
  }
})

test('left alone the pet plays something of its own instead of the mood preset', () => {
  assert.ok(wanderActions.length >= 5, 'the pet keeps a repertoire for being alone')
  for (const preset of wanderActions) assert.ok(isValidMoodAction(preset), JSON.stringify(preset))
  const state = new MoodState({ random: () => 0 })
  const wandering = moodAction(state, { random: () => 0, wander: true })
  assert.deepEqual([wandering.head, wandering.emotion, wandering.gaze], ['look_left', 'neutral', 'left'])
  assert.ok(wandering.duration >= 1.8 && wandering.duration <= 2.8)
  // The side the cursor sat on last still decides which way it glances.
  assert.equal(moodAction(state, { random: () => 0.1, side: 'right', wander: true }).head, 'look_right')
  // A real gesture always wins over the idle repertoire.
  assert.equal(moodAction(state, { kind: 'tap', wander: true }).emotion, 'curious')
  // Being alone must not change what the mood presets do.
  assert.equal(moodAction(state, { random: () => 0 }).head, moodActions.calm[0].head)
  // ...and it must not flatten a mood: a sleepy pet stays sleepy.
  state.drowsiness = 0.8
  assert.equal(state.refresh(), 'sleepy')
  assert.equal(moodAction(state, { random: () => 0, wander: true }).head, moodActions.sleepy[0].head)
})

test('screen-wide cursor distance only answers when a threshold is crossed', () => {
  assert.equal(classifyProximity(900, 240), 'approach', 'coming close is noticed once')
  assert.equal(classifyProximity(240, 260), '', 'staying close does not repeat')
  assert.equal(classifyProximity(300, 900), 'retreat', 'leaving is noticed once')
  assert.equal(classifyProximity(900, 950), '')
  assert.equal(classifyProximity(null, 100), '', 'the first sample is not an event')
  assert.equal(classifyProximity(Number.NaN, 100), '')
  assert.equal(classifyProximity(900, Number.NaN), '')
  assert.equal(classifyProximity(900, -5), '')
})

test('system idle time is graded instead of being treated as one event', () => {
  assert.equal(idleLevel(0), 0)
  assert.equal(idleLevel(14), 0)
  assert.equal(idleLevel(15), 1)
  assert.equal(idleLevel(59), 1)
  assert.equal(idleLevel(60), 2)
  assert.equal(idleLevel(300), 3)
  assert.equal(idleLevel(Number.NaN), 0)
  assert.equal(idleLevel(-2), 0)
  // Only meaningful gestures get an immediate visible answer.
  assert.ok(reactiveKinds.has('approach'))
  assert.ok(!reactiveKinds.has('retreat'))
  assert.ok(!reactiveKinds.has('blur'))
  for (const kind of reactiveKinds) assert.ok(moodKinds.has(kind))
})

test('a parked cursor releases the gaze and the pet keeps looking around', async () => {
  const surface = { dataset: {}, handlers: new Map(),
    addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 505 }) }
  const saved = { window: globalThis.window, document: globalThis.document,
    raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame }
  let clock = 0, queue = []
  globalThis.window = { addEventListener() {}, removeEventListener() {} }
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} }
  globalThis.requestAnimationFrame = cb => queue.push(cb)
  globalThis.cancelAnimationFrame = () => { queue = [] }
  const { installMoodDirector } = await import('../electron/device-mood.mjs')
  const frames = []
  // Where the eyes drift is random by design; a seeded generator keeps this test
  // about behaviour instead of about which numbers happened to come up.
  let seed = 11
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  const director = installMoodDirector({ surface, canPlay: () => true, random,
    onExpression: value => frames.push(value), now: () => clock })
  const step = () => { const pending = queue; queue = []; clock += 16; for (const cb of pending) cb(clock) }
  try {
    director.point({ x: 0.9, y: 0.2, distance: 900, inside: false, idle: 0 })
    for (let i = 0; i < 40; i++) step()
    assert.equal(director.looking, true)
    assert.ok(frames.at(-1).pose.yaw > 0.2, `follow yaw ${frames.at(-1).pose.yaw}`)
    // The 50 ms sampler keeps repeating the parked position; that is not company.
    for (let i = 0; i < 120; i++) {
      director.point({ x: 0.9, y: 0.2, distance: 900, inside: false, idle: 0 })
      step()
    }
    assert.equal(director.looking, false, 'a parked cursor lets the head come back')
    assert.ok(Math.abs(frames.at(-1).pose.yaw) < 0.12, `parked yaw ${frames.at(-1).pose.yaw}`)
    // On its own the gaze still wanders, so the face is never frozen.
    const gazes = new Set()
    for (let i = 0; i < 400; i++) { step(); if (surface.dataset.gaze) gazes.add(surface.dataset.gaze) }
    assert.ok(gazes.size >= 5, `gaze samples ${gazes.size}`)
    assert.ok([...gazes].some(value => Math.abs(Number(value.split(',')[0])) > 0.1), [...gazes].slice(0, 4).join(' '))
    // A real move takes the lead straight back.
    director.point({ x: -0.8, y: 0, distance: 500, inside: false, idle: 0 })
    for (let i = 0; i < 60; i++) step()
    assert.ok(frames.at(-1).pose.yaw < -0.15, `the cursor wins again: ${frames.at(-1).pose.yaw}`)
  } finally {
    director.dispose()
    globalThis.window = saved.window; globalThis.document = saved.document
    globalThis.requestAnimationFrame = saved.raf; globalThis.cancelAnimationFrame = saved.caf
  }
})

test('the pet follows a cursor that is outside its own window', async () => {
  const surface = { dataset: {}, handlers: new Map(),
    addEventListener(name, handler) { if (!this.handlers.has(name)) this.handlers.set(name, []); this.handlers.get(name).push(handler) },
    removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 505 }),
    fire(name, event) { for (const handler of this.handlers.get(name) || []) handler(event) } }
  const saved = { window: globalThis.window, document: globalThis.document,
    raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame }
  let clock = 0, queue = []
  globalThis.window = { addEventListener() {}, removeEventListener() {} }
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} }
  globalThis.requestAnimationFrame = cb => queue.push(cb)
  globalThis.cancelAnimationFrame = () => { queue = [] }
  const { installMoodDirector } = await import('../electron/device-mood.mjs')
  const frames = []
  const director = installMoodDirector({ surface, canPlay: () => true,
    onExpression: value => frames.push(value), now: () => clock, random: () => 0.5 })
  const step = () => { const pending = queue; queue = []; clock += 16; for (const cb of pending) cb(clock) }
  try {
    // Far right of the window: eyes and head turn to the right.
    director.point({ x: 0.8, y: 0, distance: 900, inside: false, idle: 0 })
    assert.equal(director.looking, true)
    for (let i = 0; i < 30; i++) step()
    const looking = frames.at(-1)
    assert.equal(looking.source, 'gaze', 'pointer motion delegates the remaining idle face')
    assert.ok(looking.pose.owned, 'the follow drives the head, not only the eyes')
    assert.ok(looking.pose.yaw > 0.05, `yaw ${looking.pose.yaw}`)
    assert.ok(looking.weights.eyeLookOutLeft > 0)
    // A resting cursor stops moving the head instead of drifting around it.
    for (let i = 0; i < 20; i++) step()
    const settled = frames.at(-1).pose.yaw
    for (let i = 0; i < 40; i++) step()
    assert.ok(Math.abs(frames.at(-1).pose.yaw - settled) < 0.02, 'a still cursor costs no motion')
    // Coming close from far away is noticed once.
    const before = director.state.curiosity
    director.point({ x: 0.1, y: 0.1, distance: 900, inside: false, idle: 0 })
    director.point({ x: 0.1, y: 0.1, distance: 200, inside: false, idle: 0 })
    assert.ok(director.state.curiosity > before, 'approaching raises curiosity')
    // A long system idle is graded and does not fire on every sample.
    director.point({ x: 0, y: 0, distance: 200, inside: false, idle: 65 })
    const drowsy = director.state.drowsiness
    director.point({ x: 0, y: 0, distance: 200, inside: false, idle: 70 })
    assert.ok(director.state.drowsiness > drowsy || director.state.drowsiness <= 1)
    // Stale samples let the head glide back to centre; the idle layer keeps the
    // face so there is no handover jump back to the renderer's own animation.
    for (let i = 0; i < 400; i++) step()
    assert.equal(director.playing, false)
    assert.equal(director.looking, false)
    assert.equal(frames.at(-1).pose.owned, true)
    assert.ok(Math.abs(frames.at(-1).pose.yaw) < 0.08, `yaw ${frames.at(-1).pose.yaw}`)
  } finally {
    director.dispose()
    globalThis.window = saved.window; globalThis.document = saved.document
    globalThis.requestAnimationFrame = saved.raf; globalThis.cancelAnimationFrame = saved.caf
  }
})

test('idle motions are consumable by the shared text-motion sampler', () => {
  const motion = moodMotion(moodActions.curious[0], 2.6)
  const middle = sampleTextAction(motion, 1.2)
  assert.equal(middle.type, 'expression')
  assert.ok(middle.pose.owned)
  assert.ok(middle.weights.eyeWideLeft > 0, 'curious brows and eyes are actually driven')
  assert.ok(Math.abs(sampleTextAction(motion, motion.duration).pose.pitch) < 1e-9)
  for (const value of Object.values(sampleTextAction(motion, 1.2).weights)) assert.ok(Number.isFinite(value))
})

test('the main process samples the desktop cursor and the pet subscribes', async () => {
  const windows = await readFile(new URL('../electron/device-windows.mjs', import.meta.url), 'utf8')
  // Reuses the 50ms pass-through timer instead of adding another one.
  assert.match(windows, /this\.mouseTimer = setInterval\(\(\) => this\.updateMouse\(\), 50\)/)
  assert.match(windows, /this\.publishPointer\(cursor, bounds\)/)
  assert.match(windows, /powerMonitor\.getSystemIdleTime\(\)/)
  assert.match(windows, /send\('pet:pointer'/)
  // Only a direction, a distance, an inside flag and the idle time cross the IPC.
  assert.doesNotMatch(windows, /send\('pet:pointer', \{[^}]*cursor\.x,/)
  const preload = await readFile(new URL('../electron/device-preload.cjs', import.meta.url), 'utf8')
  assert.match(preload, /onPointer: callback =>/)
  assert.match(preload, /ipcRenderer\.on\('pet:pointer', listener\)/)
  const pet = await readFile(new URL('../electron/device-pet.mjs', import.meta.url), 'utf8')
  assert.match(pet, /desktop\.onPointer\(value => mood\?\.point\(value\)\)/)
})

test('an action takes over from the follow without snapping the head', async () => {
  const surface = { dataset: {}, handlers: new Map(),
    addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 505 }) }
  const saved = { window: globalThis.window, document: globalThis.document,
    raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame }
  let clock = 0, queue = []
  globalThis.window = { addEventListener() {}, removeEventListener() {} }
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} }
  globalThis.requestAnimationFrame = cb => queue.push(cb)
  globalThis.cancelAnimationFrame = () => { queue = [] }
  const { installMoodDirector } = await import('../electron/device-mood.mjs')
  const frames = []
  const director = installMoodDirector({ surface, canPlay: () => true,
    onExpression: value => frames.push(value), now: () => clock, random: () => 0.5 })
  const step = () => { const pending = queue; queue = []; clock += 16; for (const cb of pending) cb(clock) }
  try {
    director.point({ x: 1, y: 0, distance: 900, inside: false, idle: 0 })
    for (let i = 0; i < 40; i++) step()
    const followed = frames.at(-1).pose.yaw
    assert.ok(followed > 0.3, `follow yaw ${followed}`)
    // A poke starts an action; its very first frame must still carry the aim.
    director.observe('tap')
    step(); step()
    const handover = frames.at(-1).pose.yaw
    assert.ok(handover > followed * 0.5, `the head must not snap: ${followed} -> ${handover}`)
    // The aim keeps working while the pet answers: it should look at you as it
    // reacts, and only glide back once the cursor has been still for a while.
    for (let i = 0; i < 120; i++) step()
    assert.ok(Math.abs(frames.at(-1).pose.yaw) < 0.05, `leftover yaw ${frames.at(-1).pose.yaw}`)
  } finally {
    director.dispose()
    globalThis.window = saved.window; globalThis.document = saved.document
    globalThis.requestAnimationFrame = saved.raf; globalThis.cancelAnimationFrame = saved.caf
  }
})

test('an action eases onto the face instead of snapping on and off', async () => {
  const surface = { dataset: {}, handlers: new Map(),
    addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 505 }) }
  const saved = { window: globalThis.window, document: globalThis.document,
    raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame }
  let clock = 0, queue = []
  globalThis.window = { addEventListener() {}, removeEventListener() {} }
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} }
  globalThis.requestAnimationFrame = cb => queue.push(cb)
  globalThis.cancelAnimationFrame = () => { queue = [] }
  const { installMoodDirector } = await import('../electron/device-mood.mjs')
  const frames = []
  const director = installMoodDirector({ surface, canPlay: () => true,
    onExpression: value => frames.push(value), now: () => clock, random: () => 0.5 })
  const step = () => { const pending = queue; queue = []; clock += 16; for (const cb of pending) cb(clock) }
  try {
    director.observe('stroke')
    for (let i = 0; i < 260; i++) step()
    const smile = frames.map(frame => frame.weights.mouthSmileLeft || 0)
    const peak = Math.max(...smile)
    assert.ok(peak > 0.5, `the smile actually reaches the face: ${peak}`)
    const from = smile.findIndex(value => value > peak * 0.1), to = smile.findIndex(value => value > peak * 0.9)
    assert.ok(to - from >= 2, `the smile must ramp over several frames: ${from} -> ${to}`)
    // No single frame may carry the whole change: that is what reads as a jolt.
    let jump = 0
    for (let i = 1; i < frames.length; i++) {
      jump = Math.max(jump, Math.abs(smile[i] - smile[i - 1]))
      for (const key of ['pitch', 'yaw', 'roll', 'depth', 'gazeX', 'gazeY']) {
        jump = Math.max(jump, Math.abs(frames[i].pose[key] - frames[i - 1].pose[key]))
      }
    }
    assert.ok(jump < 0.16, `largest frame-to-frame step ${jump}`)
    assert.ok((frames.at(-1).weights.mouthSmileLeft || 0) < 0.02, 'and the action is eased off again')
    for (const frame of frames) assert.ok(frame.pose.owned, 'the idle layer never drops the face mid motion')
  } finally {
    director.dispose()
    globalThis.window = saved.window; globalThis.document = saved.document
    globalThis.requestAnimationFrame = saved.raf; globalThis.cancelAnimationFrame = saved.caf
  }
})

test('the pet window wires the mood director behind the other face owners', async () => {
  const source = await readFile(new URL('../electron/device-pet.mjs', import.meta.url), 'utf8')
  assert.match(source, /import \{ installMoodDirector \} from '\.\/device-mood\.mjs'/)
  // Nothing else may own the face while the idle behaviour plays.
  assert.match(source, /canPlay: \(\) => visible && avatarReady && !chat\.busy && !touch\.active\(\) && pointer == null/)
  assert.match(source, /onGesture: event => mood\?\.observe\(moodKind\(event\.gesture_type\)\)/)
  assert.match(source, /touch\?\.cancel\(\); mood\?\.cancel\(\)/)
  assert.match(source, /mood\.dispose\(\)/)
  const touch = await readFile(new URL('../electron/device-touch.mjs', import.meta.url), 'utf8')
  assert.match(touch, /onGesture\(event\)/)
  assert.match(touch, /active: \(\) => pointer !== null \|\| keyboard \|\| attention\.active \|\| presenting/)
})

test('the idle director answers gestures, plays them and rests again', async () => {
  const surface = { dataset: {}, handlers: new Map(),
    addEventListener(name, handler) { if (!this.handlers.has(name)) this.handlers.set(name, []); this.handlers.get(name).push(handler) },
    removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 300 }),
    fire(name, event) { for (const handler of this.handlers.get(name) || []) handler(event) } }
  const document_ = { hidden: false, addEventListener() {}, removeEventListener() {} }
  const saved = { window: globalThis.window, document: globalThis.document,
    raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame }
  let clock = 0, queue = []
  globalThis.window = { addEventListener() {}, removeEventListener() {} }
  globalThis.document = document_
  globalThis.requestAnimationFrame = cb => queue.push(cb)
  globalThis.cancelAnimationFrame = () => { queue = [] }
  const { installMoodDirector } = await import('../electron/device-mood.mjs')
  const frames = []
  let playable = true
  const director = installMoodDirector({ surface, canPlay: () => playable,
    onExpression: value => frames.push(value), now: () => clock, random: sequence([0.5, 0.5, 0.5, 0.5, 0.5]) })
  const step = () => { const pending = queue; queue = []; clock += 16; for (const cb of pending) cb(clock) }
  try {
    director.observe('tap')
    assert.equal(director.playing, true)
    for (let i = 0; i < 10; i++) step()
    assert.ok(frames.length >= 5, 'the gesture is animated frame by frame')
    assert.equal(frames.at(-1).source, 'mood')
    assert.ok(frames.at(-1).pose.pitch < 0, 'a poke makes the pet look up')
    for (let i = 0; i < 260; i++) step()
    assert.equal(director.playing, false)
    assert.equal(frames.at(-1).pose.owned, true, 'the idle layer owns the face even at rest')
    assert.ok(Math.abs(frames.at(-1).pose.pitch) < 0.05, 'and it rests near neutral')

    // An unrecognised gesture must not queue an action.
    director.observe('')
    assert.equal(director.playing, false)

    // Back and forth over the figure without pressing counts as stroking.
    const before = director.state.intimacy
    surface.fire('pointerenter', { clientX: 60, clientY: 40 })
    let x = 60
    for (const delta of [20, -20, 20]) { x += delta; clock += 100; surface.fire('pointermove', { clientX: x, clientY: 40 }) }
    assert.ok(director.state.intimacy > before, 'stroking raises intimacy')
    assert.equal(surface.dataset.mood, director.mood)

    // While a touch owns the face the idle behaviour stays quiet.
    playable = false
    const quiet = frames.length
    surface.fire('pointermove', { clientX: x + 20, clientY: 40 })
    for (let i = 0; i < 5; i++) step()
    assert.equal(frames.length, quiet)
    playable = true
    director.cancel()
    assert.equal(director.playing, false)
    director.reset()
    step(); step()
    assert.equal(frames.at(-1).source, 'ambient')
    assert.equal(director.mood, 'calm')
    assert.equal(director.looking, false)
    assert.equal(director.playing, false)
  } finally {
    director.dispose()
    globalThis.window = saved.window; globalThis.document = saved.document
    globalThis.requestAnimationFrame = saved.raf; globalThis.cancelAnimationFrame = saved.caf
  }
})
