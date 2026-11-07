package com.zhanlv.lam.expression;

import java.text.BreakIterator;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.function.DoubleSupplier;
import java.util.regex.Pattern;

/**
 * Captured ambient motion and persistent presentation pose, ported from
 * AIBANLVAmbientMotion.swift at origin/ios-plugin 2e75b5f. A serial caller owns
 * this object and supplies validated renderer-order samples and monotonic time.
 */
public final class AmbientMotion {
    private static final Pattern SENTENCE_END = Pattern.compile("[\u3002\uff01\uff1f!?\uff1b;]");
    private static final float[] HEAD_GAINS = {.19f, .21f, .17f};
    private final KeyframeFaceLibrary library;
    private final int[] indices;
    private final int[] headIndices;
    private final DoubleSupplier random;
    private final List<String> recent = new ArrayList<>();
    private KeyframeFaceLibrary.Clip clip;
    private double clipTime, clipStart, clipDuration;
    private Double lastTime;
    private String lastMode = "none";
    private float[] entryFace = new float[52];
    private float[] entryHead = new float[3];
    private float entryDepth;
    private double transition, speechTime;
    private String gesture = "none";
    private double gestureTime = 100;
    private double nextGesture = 4;
    private float gestureAmplitude;
    private double ambientTime, motionTime;
    private float attentionX, attentionY, attentionHeadYaw;
    private float attentionTargetX, attentionTargetY, attentionHeadTarget;
    private double attentionHoldUntil;
    private double nextAttentionAt = .8;
    private float[] heldSpeechSource = new float[0];
    private float[] heldSpeechHead = new float[0];
    private float[] heldSpeechGaze = new float[0];
    private String heldSpeechAction = "none";
    private String heldSpeechDepthAction = "none";
    private String contextEmotion = "neutral";
    private String contextCandidate = "neutral";
    private int contextConfirmations;
    private boolean contextChanged;
    private String listeningContextSource = "default";
    private float[] face = new float[52];
    private float[] head = new float[3];
    private float depth;
    private String clipID = "none";

    public AmbientMotion(KeyframeFaceLibrary library, DoubleSupplier random) {
        this.library = library;
        this.random = random;
        indices = library == null ? new int[52] : library.rendererIndices();
        headIndices = library == null ? new int[3] : library.headIndices();
        if (library == null) {
            Arrays.fill(indices, -1);
            Arrays.fill(headIndices, -1);
        }
    }

    public boolean available() { return library != null; }
    public String clipID() { return clipID; }
    public String listeningContextSource() { return listeningContextSource; }

    /** Retain the presented pose, but start each reply's gesture even without an idle callback. */
    public void beginTurn() {
        lastMode = "turn-boundary";
        heldSpeechSource = new float[0];
    }

    /** 52 face, pitch/yaw/roll, legacy gaze placeholders, ownership, depth. */
    public float[] currentFrame() {
        float[] frame = Arrays.copyOf(face, 59);
        System.arraycopy(head, 0, frame, 52, 3);
        frame[57] = 1;
        frame[58] = depth;
        return frame;
    }

    public void reset() {
        recent.clear();
        clip = null;
        clipID = "none";
        lastTime = null;
        lastMode = "none";
        face = new float[52];
        head = new float[3];
        depth = 0;
        ambientTime = 0;
        gestureTime = 100;
        gesture = "none";
        nextGesture = 4;
        motionTime = 0;
        attentionX = attentionY = attentionHeadYaw = 0;
        attentionTargetX = attentionTargetY = attentionHeadTarget = 0;
        attentionHoldUntil = 0;
        nextAttentionAt = .8;
        heldSpeechSource = new float[0];
        heldSpeechHead = new float[0];
        heldSpeechGaze = new float[0];
        heldSpeechAction = heldSpeechDepthAction = "none";
        contextEmotion = contextCandidate = "neutral";
        contextConfirmations = 0;
        contextChanged = false;
        listeningContextSource = "default";
    }

    public void updateListeningContext(String text, String emotion) {
        String explicit = emotion == null ? null : contextLabel(emotion.toLowerCase(Locale.ROOT));
        String inferred = KeyframeFacePlayer.semanticEmotion(text, false);
        String desired = explicit == null ? contextLabel(inferred) : explicit;
        if (desired == null) desired = "neutral";
        if (explicit == null && "neutral".equals(inferred)
                && containsAny(text, "\u4e3a\u4ec0\u4e48", "\u600e\u4e48", "\u5982\u4f55", "\uff1f", "?")) {
            desired = "curious";
        }
        if (desired.equals(contextCandidate)) contextConfirmations++;
        else {
            contextCandidate = desired;
            contextConfirmations = 1;
        }
        if (explicit == null && !SENTENCE_END.matcher(text).find()
                && !(atLeastEightCharacters(text) && contextConfirmations >= 2)) return;
        listeningContextSource = explicit != null ? "asr-emotion" : "asr-text";
        if (!contextEmotion.equals(desired)) {
            contextEmotion = desired;
            contextChanged = true;
        }
    }

    private double step(double now, String mode) {
        double dt = Math.min(.1, Math.max(0, lastTime == null ? 1 / 30.0 : now - lastTime));
        lastTime = now;
        if (!mode.equals(lastMode)) {
            rememberEntry();
            lastMode = mode;
            gesture = "none";
            gestureTime = 100;
            nextGesture = ambientTime + 3 + random.getAsDouble() * 4;
            if ("speech".equals(mode)) speechTime = 0;
        }
        transition += dt;
        motionTime += dt;
        return dt;
    }

    private void updateAttention(double dt, String mode) {
        if (attentionHoldUntil > 0 && motionTime >= attentionHoldUntil) {
            attentionTargetX = attentionTargetY = attentionHeadTarget = 0;
            attentionHoldUntil = 0;
            double interval = "listening".equals(mode)
                    ? 1 + random.getAsDouble() * 1.6 : 1.6 + random.getAsDouble() * 2.2;
            nextAttentionAt = motionTime + interval;
        } else if (attentionHoldUntil == 0 && motionTime >= nextAttentionAt) {
            boolean largerGlance = random.getAsDouble() < ("listening".equals(mode) ? .28 : .18);
            float sign = random.getAsDouble() < .5 ? -1 : 1;
            float amplitude = (float) (largerGlance ? .12 + random.getAsDouble() * .045
                    : .05 + random.getAsDouble() * .04);
            attentionTargetX = sign * amplitude;
            attentionTargetY = (float) ((random.getAsDouble() - .5) * (largerGlance ? .075 : .05));
            attentionHeadTarget = attentionTargetX * (largerGlance ? 1 : .42f);
            attentionHoldUntil = motionTime + .38 + random.getAsDouble() * .48;
        }
        double eyeRate = attentionHoldUntil > 0 ? 13 : 5.5;
        float eyeAlpha = (float) (1 - Math.exp(-Math.min(.1, dt) * eyeRate));
        float headAlpha = (float) (1 - Math.exp(-Math.min(.1, dt) * 3.8));
        attentionX += (attentionTargetX - attentionX) * eyeAlpha;
        attentionY += (attentionTargetY - attentionY) * eyeAlpha;
        attentionHeadYaw += (attentionHeadTarget - attentionHeadYaw) * headAlpha;
    }

    private void choose(boolean listening, String emotion) {
        String preferred = "default".equals(listeningContextSource) ? emotion : contextEmotion;
        boolean empathetic = oneOf(preferred, "sad", "angry", "fearful", "caring");
        List<KeyframeFaceLibrary.Clip> pool = new ArrayList<>();
        for (KeyframeFaceLibrary.Clip candidate : library.clips) {
            boolean allowed = listening
                    ? empathetic ? oneOf(candidate.emotion, "neutral", "warm", "caring")
                    : oneOf(candidate.emotion, "neutral", "warm", "caring", "thinking", "curious")
                    : oneOf(candidate.emotion, "neutral", "warm", "thinking", "curious");
            if (allowed && candidate.frameCount() >= 60) pool.add(candidate);
        }
        List<KeyframeFaceLibrary.Clip> candidates = new ArrayList<>();
        for (KeyframeFaceLibrary.Clip candidate : pool) {
            if (!recent.contains(candidate.id)) candidates.add(candidate);
        }
        if (candidates.isEmpty()) {
            for (KeyframeFaceLibrary.Clip candidate : pool) {
                if (!candidate.id.equals(clipID)) candidates.add(candidate);
            }
        }
        if (candidates.isEmpty()) return;
        double[] weights = new double[candidates.size()];
        double total = 0;
        for (int i = 0; i < weights.length; i++) {
            String label = candidates.get(i).emotion;
            weights[i] = empathetic && "caring".equals(label) ? 3
                    : listening && label.equals(preferred) ? 3 : oneOf(label, "neutral", "warm") ? 2 : 1;
            total += weights[i];
        }
        double draw = random.getAsDouble() * total;
        int selected = candidates.size() - 1;
        for (int i = 0; i < weights.length; i++) {
            draw -= weights[i];
            if (draw <= 0) {
                selected = i;
                break;
            }
        }
        clip = candidates.get(selected);
        clipID = clip.id;
        recent.add(clipID);
        int keep = Math.min(5, Math.max(0, pool.size() - 1));
        if (recent.size() > keep) recent.subList(0, recent.size() - keep).clear();
        double duration = (clip.frameCount() - 1) / clip.fps;
        clipDuration = Math.min(duration, 2.8 + random.getAsDouble() * 2.4);
        clipStart = random.getAsDouble() * Math.max(0, duration - clipDuration);
        clipTime = 0;
        contextChanged = false;
        rememberEntry();
    }

    public float[] ambient(double nowSeconds, boolean listening, String emotion) {
        if (!available()) return null;
        String mode = listening ? "listening" : "idle";
        double dt = step(nowSeconds, mode);
        updateAttention(dt, mode);
        ambientTime += dt;
        clipTime += dt;
        if (clip == null || clipTime >= clipDuration || listening && contextChanged && clipTime >= 1.6) {
            choose(listening, emotion);
        }
        if (clip == null) return null;
        double position = Math.min(clip.frameCount() - 1, (clipStart + clipTime) * clip.fps);
        int lo = (int) position;
        int hi = Math.min(lo + 1, clip.frameCount() - 1);
        float t = (float) (position - lo);
        float[] raw = clip.frameAt(lo);
        float[] next = clip.frameAt(hi);
        for (int i = 0; i < raw.length; i++) raw[i] = raw[i] * (1 - t) + next[i] * t;
        float[] target = new float[52];
        for (int i = 0; i < target.length; i++) {
            target[i] = indices[i] >= 0 ? raw[indices[i]] : 0;
            if (IosExpressionCurves.articulation(i)) target[i] = 0;
            else if (i != 0 && i != 7) target[i] *= listening ? .68f : .44f;
        }
        for (int i = 0; i < 52; i++) {
            if (IosExpressionCurves.gazeChannel(i)) target[i] *= .6f;
        }
        float[] pose = new float[3];
        for (int axis = 0; axis < 3; axis++) {
            int channel = headIndices[axis];
            if (channel < 0) continue;
            float baseline = 0;
            int count = Math.min(9, clip.frameCount());
            for (int n = 0; n < count; n++) baseline += clip.frameAt(n)[channel];
            baseline /= count;
            pose[axis] = (raw[channel] - baseline) / HEAD_GAINS[axis] * (listening ? .65f : .4f);
        }
        if (listening && ambientTime >= nextGesture) {
            gesture = "nod";
            gestureTime = 0;
            gestureAmplitude = (float) (.14 + random.getAsDouble() * .12);
            nextGesture = ambientTime + 5 + random.getAsDouble() * 5;
        }
        gestureTime += dt;
        float[] g = gestureSample();
        pose[0] += g[0];
        pose[1] += g[1] + attentionHeadYaw;
        float lean = (float) Math.sin(ambientTime * .7) * .12f + (listening ? .17f : 0) + g[2];
        return compose(target, pose, lean, attentionX, attentionY, dt, false);
    }

    public float[] speech(float[] source, float[] pose, float[] semanticGaze,
            String action, String depthAction, double nowSeconds) {
        if (source.length >= 52) {
            heldSpeechSource = source.clone();
            heldSpeechHead = pose.clone();
            heldSpeechGaze = semanticGaze.clone();
            heldSpeechAction = action;
            heldSpeechDepthAction = depthAction;
        }
        boolean entering = !"speech".equals(lastMode);
        double dt = step(nowSeconds, "speech");
        updateAttention(dt, "speech");
        speechTime += dt;
        if (entering) {
            gesture = oneOf(action, "nod", "slow_nod", "shake", "lean",
                    "look_up", "look_down", "look_left", "look_right") ? action : "none";
            double base = action.startsWith("look_") ? .48 : "shake".equals(action) ? .34 : .22;
            gestureTime = -.18;
            gestureAmplitude = (float) (base + random.getAsDouble() * (action.startsWith("look_") ? .12 : .1));
        }
        gestureTime += dt;
        float[] g = gestureSample();
        float semanticX = semanticGaze.length > 0 ? semanticGaze[0] : 0;
        float semanticY = semanticGaze.length > 1 ? semanticGaze[1] : 0;
        float[] target = {pose[0] + g[0],
                pose[1] + g[1] + attentionHeadYaw + clamp(semanticX * .65f, -.18f, .18f), pose[2]};
        float directedDepth;
        float depthEntry = ease(speechTime / .7);
        switch (depthAction) {
            case "forward":
                directedDepth = .43f * depthEntry + (float) Math.sin(speechTime * .8) * .025f;
                break;
            case "back":
                directedDepth = -.28f * depthEntry + (float) Math.sin(speechTime * .8) * .02f;
                break;
            case "cycle":
                directedDepth = (float) Math.sin(speechTime * 2 * Math.PI / 2.8) * .34f * depthEntry;
                break;
            default:
                directedDepth = (float) Math.sin(speechTime * .8) * .17f + g[2];
                break;
        }
        return compose(source, target, directedDepth,
                attentionX + semanticX, attentionY + semanticY, dt, true);
    }

    /** Copies a late renderer-order phoneme without advancing presentation time. */
    public void refreshArticulation(float[] source) {
        for (int i = 0; i < 52; i++) {
            if (!IosExpressionCurves.articulation(i)) continue;
            face[i] = source[i];
            if (heldSpeechSource.length >= 52) heldSpeechSource[i] = source[i];
        }
    }

    public float[] holdSpeech(double nowSeconds) {
        if (heldSpeechSource.length < 52) return currentFrame();
        return speech(heldSpeechSource, heldSpeechHead, heldSpeechGaze,
                heldSpeechAction, heldSpeechDepthAction, nowSeconds);
    }

    private float[] gestureSample() {
        boolean looking = gesture.startsWith("look_");
        double duration = looking ? 2.4 : oneOf(gesture, "slow_nod", "lean") ? 2
                : "shake".equals(gesture) ? 1.6 : 1.35;
        if (gestureTime <= 0 || gestureTime >= duration) return new float[3];
        double phase = gestureTime / duration;
        float window = (float) Math.pow(Math.sin(Math.PI * phase), 2);
        float movement = (float) Math.sin(2 * Math.PI * phase) * window * gestureAmplitude;
        float heldLook = window * gestureAmplitude;
        if ("none".equals(gesture)) return new float[3];
        float pitch = "look_up".equals(gesture) ? -heldLook : "look_down".equals(gesture) ? heldLook
                : oneOf(gesture, "nod", "slow_nod") ? movement : 0;
        float yaw = "look_left".equals(gesture) ? heldLook : "look_right".equals(gesture) ? -heldLook
                : "shake".equals(gesture) ? movement : 0;
        return new float[] {pitch, yaw, window * ("lean".equals(gesture) ? .3f : .14f)};
    }

    private float[] compose(float[] input, float[] pose, float lean,
            float gazeX, float gazeY, double dt, boolean speech) {
        float[] expressive = input.clone();
        if (speech) {
            for (int i = 0; i < 52; i++) {
                float gain = expressionGain(i);
                if (gain != 1) expressive[i] = Math.min(1, expressive[i] * gain);
            }
        }
        float[] target = applyingGaze(expressive, gazeX, gazeY);
        float faceT = ease(transition / .55);
        float mouthT = ease(transition / .24);
        for (int i = 0; i < 52; i++) {
            boolean articulation = IosExpressionCurves.articulation(i);
            // The current hardware-clock mouth sample must never be filtered.
            if (speech && articulation) face[i] = target[i];
            else {
                float t = articulation ? mouthT : faceT;
                float desired = clamp(entryFace[i] + (target[i] - entryFace[i]) * t, 0, 1);
                if (IosExpressionCurves.gazeChannel(i)) {
                    float limit = (float) dt * .35f;
                    face[i] += clamp(desired - face[i], -limit, limit);
                } else face[i] = desired;
            }
        }
        float poseT = ease(transition / .65);
        for (int axis = 0; axis < 3; axis++) {
            float desired = entryHead[axis] + (clamp(pose[axis], -.85f, .85f) - entryHead[axis]) * poseT;
            float limit = (float) dt * 1.8f;
            head[axis] += clamp(desired - head[axis], -limit, limit);
        }
        float desiredDepth = entryDepth + (clamp(lean, -.6f, .6f) - entryDepth) * poseT;
        float depthStep = (float) dt * .7f;
        depth += clamp(desiredDepth - depth, -depthStep, depthStep);
        return currentFrame();
    }

    private static float[] applyingGaze(float[] source, float x, float y) {
        float[] result = source.clone();
        float horizontal = ((source[2] - source[3]) + (source[10] - source[9])) * .5f;
        float vertical = ((source[1] - source[4]) + (source[8] - source[11])) * .5f;
        float baseX = (float) Math.tanh(horizontal * 2.0) * .10f;
        float baseY = (float) Math.tanh(vertical * 2.0) * .08f;
        horizontal = clamp(baseX + x, -.18f, .18f);
        vertical = clamp(baseY + y, -.12f, .12f);
        for (int i = 0; i < 52; i++) {
            if (IosExpressionCurves.gazeChannel(i)) result[i] = 0;
        }
        result[2] = result[10] = Math.max(0, horizontal);
        result[3] = result[9] = Math.max(0, -horizontal);
        result[1] = result[8] = Math.max(0, vertical);
        result[4] = result[11] = Math.max(0, -vertical);
        return result;
    }

    private void rememberEntry() {
        entryFace = face.clone();
        entryHead = head.clone();
        entryDepth = depth;
        transition = 0;
    }

    private static float expressionGain(int i) {
        if (i >= 41 && i <= 45) return 1.28f;
        if (i >= 46 && i <= 50) return 1.34f;
        if (i >= 23 && i <= 28) return 1.20f;
        if (i == 5 || i == 6 || i == 12 || i == 13) return 1.16f;
        return 1;
    }

    private static String contextLabel(String emotion) {
        switch (emotion) {
            case "sad": case "angry": case "fearful": case "disgusted": return "caring";
            case "happy": case "excited": return "warm";
            case "surprised": return "curious";
            case "neutral": case "caring": case "thinking": case "curious": case "warm": return emotion;
            default: return null;
        }
    }

    private static boolean atLeastEightCharacters(String text) {
        BreakIterator characters = BreakIterator.getCharacterInstance(Locale.ROOT);
        characters.setText(text);
        for (int n = 0; n < 8; n++) {
            if (characters.next() == BreakIterator.DONE) return false;
        }
        return true;
    }

    private static boolean oneOf(String value, String... choices) {
        for (String choice : choices) if (choice.equals(value)) return true;
        return false;
    }

    private static boolean containsAny(String text, String... terms) {
        for (String term : terms) if (text.contains(term)) return true;
        return false;
    }

    private static float ease(double value) {
        return IosExpressionCurves.smoothStep((float) Math.min(1, Math.max(0, value)));
    }

    private static float clamp(float value, float minimum, float maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }
}
