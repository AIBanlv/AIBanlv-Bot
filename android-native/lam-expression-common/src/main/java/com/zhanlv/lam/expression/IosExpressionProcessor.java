package com.zhanlv.lam.expression;

import java.util.Arrays;
import java.util.function.DoubleSupplier;

/**
 * Renderer-independent port of the iOS presentation sequence at 2e75b5f.
 * The caller supplies clock ticks. Inference and transport never advance this object.
 */
public final class IosExpressionProcessor {
    public static final String VERSION = "ios-expression-v1-2e75b5f";
    private final KeyframeFacePlayer captures;
    private final AmbientMotion ambient;
    private final float[] speechOverlay = new float[52];
    private final float[] listeningOverlay = new float[52];
    private Output current = new Output(new float[52], PoseV1.neutral(), "idle", "none");
    private float[] entry = new float[52];
    private float[] closure;
    private PoseV1 closurePose = PoseV1.neutral();
    private String emotion = "natural", head = "none", gaze = "contact", depth = "none";
    private String listeningEmotion = "natural";
    private boolean listening;
    private boolean explicitEmotionSelected;
    private int nextBlink = 78, ordinal, closureOrdinal, listeningOrdinal;
    private long generation = Long.MIN_VALUE;

    public IosExpressionProcessor(KeyframeFaceLibrary library, DoubleSupplier random) {
        captures = new KeyframeFacePlayer(library);
        ambient = new AmbientMotion(library, random);
    }

    public void beginTurn(long nextGeneration) {
        if (nextGeneration <= generation) return;
        generation = nextGeneration;
        captures.beginTurn();
        ambient.beginTurn();
        Arrays.fill(speechOverlay, 0);
        entry = current.frame.clone();
        closure = null;
        closureOrdinal = ordinal = 0;
        nextBlink = 78;
        emotion = "natural"; head = "none"; gaze = "contact"; depth = "none";
        explicitEmotionSelected = false;
    }

    public void setReply(String emotion, boolean explicit, String clip, String performance,
            String text, String head, String gaze, String depth) {
        if (emotion != null && (explicit || !explicitEmotionSelected)) this.emotion = presetName(emotion);
        explicitEmotionSelected |= explicit;
        if (head != null) this.head = head;
        if (gaze != null) this.gaze = gaze;
        if (depth != null) this.depth = depth;
        String body = text == null ? "" : text;
        String intent = performance == null || performance.isEmpty()
                ? body : "[perform:" + performance + "]" + body;
        if (!explicit && clip == null) captures.selectSentence(intent, body, ordinal);
        captures.select(this.emotion, clip, explicit, ordinal);
    }

    public void setListening(boolean active, String text, String emotion) {
        if (active) {
            listeningOrdinal = 0;
            Arrays.fill(listeningOverlay, 0);
        }
        listening = active;
        if (emotion != null) listeningEmotion = presetName(emotion);
        ambient.updateListeningContext(text == null ? "" : text, emotion);
    }

    public void setListeningEnabled(boolean enabled) { listening = enabled; }

    /** Called once at the input boundary, never on an already adjusted frame. */
    public static float[] prepareModelFrame(float[] model) {
        if (model == null || model.length != 52) {
            throw new IllegalArgumentException("Expected 52 model-order channels");
        }
        for (float value : model) {
            if (!Float.isFinite(value)) throw new IllegalArgumentException("Non-finite model channel");
        }
        return IosExpressionCurves.remapWithWeakMouthGain(model);
    }

    public Output speech(float[] source, int frame, int audioFrames, boolean ended, double now) {
        ordinal = frame + 1;
        IosExpressionCurves.PlannedMotion motion = IosExpressionCurves.planned(
                ordinal, audioFrames, ended, head, gaze);
        float blink = blink(ordinal);
        float[] enhanced = captures.mix(source, ordinal, 1, motion.envelope, blink);
        float[] pose;
        if (enhanced == null) {
            enhanced = IosExpressionCurves.smoothOverlay(source,
                    IosExpressionCurves.preset(source, emotion, ordinal, blink, motion.envelope, gaze),
                    speechOverlay, 1);
            pose = new float[] {motion.pitch, motion.yaw, motion.roll};
        } else {
            Arrays.fill(speechOverlay, 0);
            pose = captures.sampledHead();
        }
        if (ambient.available()) {
            float[] presented = ambient.speech(enhanced, pose,
                    new float[] {motion.gazeX, motion.gazeY}, head, depth, now);
            current = fromPresented(presented, "speaking", captures.playbackClipID());
        } else {
            if (ordinal <= 10) {
                float t = IosExpressionCurves.smoothStep(ordinal / 10f);
                for (int i = 0; i < 52; i++) {
                    if (!isArticulation(i)) enhanced[i] = entry[i] + (enhanced[i] - entry[i]) * t;
                }
            }
            current = new Output(enhanced,
                    new PoseV1(pose[0], pose[1], pose[2], motion.gazeX, motion.gazeY, 0, true),
                    "speaking", "fallback");
        }
        return current;
    }

    /** A late model packet may replace the held phoneme, but must not rerun motion. */
    public Output refreshArticulation(float[] source) {
        ambient.refreshArticulation(source);
        float[] face = current.frame.clone();
        for (int i = 0; i < 52; i++) if (isArticulation(i)) face[i] = source[i];
        current = new Output(face, current.pose, current.state, current.clip);
        return current;
    }

    public void finish() {
        closure = current.frame.clone();
        closurePose = current.pose;
        closureOrdinal = 0;
    }

    public void interrupt() {
        captures.beginTurn();
        Arrays.fill(speechOverlay, 0);
        finish();
    }

    public Output ambient(double now) {
        if (ambient.available()) {
            float[] frame = ambient.ambient(now, listening, listeningEmotion);
            if (frame != null) current = fromPresented(frame, listening ? "listening" : "idle", ambient.clipID());
            return current;
        }
        if (closure != null && closureOrdinal < 15) {
            closureOrdinal++;
            float faceT = IosExpressionCurves.smoothStep(closureOrdinal / 15f);
            float mouthT = IosExpressionCurves.smoothStep(Math.min(1, closureOrdinal / 10f));
            float[] rest = restingFace(), face = new float[52];
            for (int i = 0; i < 52; i++) {
                float t = isArticulation(i) ? mouthT : faceT;
                face[i] = closure[i] + (rest[i] - closure[i]) * t;
            }
            if (closureOrdinal < 10) face[18] = Math.max(face[18], (float) Math.sin(Math.PI * mouthT) * 0.065f);
            float poseT = 1 - faceT;
            current = new Output(face, new PoseV1(closurePose.pitch * poseT,
                    closurePose.yaw * poseT, closurePose.roll * poseT,
                    closurePose.gazeX * poseT, closurePose.gazeY * poseT,
                    closurePose.depth * poseT, true), "closing", "fallback");
            return current;
        }
        float[] face = restingFace();
        if (listening && listeningOrdinal < 90) {
            int n = listeningOrdinal++;
            float envelope = IosExpressionCurves.smoothStep(Math.min(1, (n + 1) / 9f));
            if (90 - n < 18) envelope *= IosExpressionCurves.smoothStep((90 - n) / 18f);
            float[] pattern = {0.12f, 0.48f, 0.9f, 1, 0.65f, 0.24f, 0.04f};
            float blink = n >= 52 && n < 59 ? pattern[n - 52] : 0;
            float[] zero = new float[52];
            face = IosExpressionCurves.smoothOverlay(zero,
                    IosExpressionCurves.preset(zero, listeningEmotion, n, blink, envelope * 0.72f, "contact"),
                    listeningOverlay, 1);
        }
        current = new Output(face, PoseV1.neutral(), listening ? "listening" : "idle", "fallback");
        return current;
    }

    public Output current() { return current; }
    public void adoptPresented(Output output) { current=output; }

    /** Presentation clock continues through PCM gaps; only the audio clock changes phonemes. */
    public Output holdSpeech(double now) {
        if (ambient.available()) {
            current = fromPresented(ambient.holdSpeech(now), "speaking", current.clip);
        }
        return current;
    }
    public boolean capturedAvailable() { return captures.available(); }
    public String selectionReason() { return captures.selectionReason(); }

    private float blink(int frame) {
        float[] pattern = {0.12f, 0.46f, 0.86f, 1, 0.7f, 0.32f, 0.08f};
        if (frame < nextBlink) return 0;
        int phase = frame - nextBlink;
        if (phase < pattern.length) return pattern[phase];
        nextBlink = frame + 84 + ((frame * 37) % 67);
        return 0;
    }

    public static boolean isArticulation(int index) {
        return (index >= 14 && index <= 22) || (index >= 29 && index <= 40) || index == 51;
    }

    private static String presetName(String value) {
        if ("neutral".equals(value)) return "natural";
        if ("thinking".equals(value)) return "thoughtful";
        return value;
    }

    private static float[] restingFace() {
        float[] face = new float[52];
        face[5] = face[12] = 0.025f;
        face[23] = face[24] = 0.035f;
        face[43] = 0.015f; face[44] = face[45] = 0.025f;
        face[47] = face[48] = 0.02f;
        return face;
    }

    private Output fromPresented(float[] frame, String state, String clip) {
        return new Output(Arrays.copyOf(frame, 52),
                new PoseV1(frame[52], frame[53], frame[54], 0, 0, frame[58], true), state, clip);
    }

    public static final class Output {
        public final int version = 1;
        public final float[] frame;
        public final PoseV1 pose;
        public final String state, clip;
        public Output(float[] frame, PoseV1 pose, String state, String clip) {
            this.frame = frame; this.pose = pose; this.state = state; this.clip = clip;
        }
    }

    /** Normalized presentation coordinates, independent of any rig or face array. */
    public static final class PoseV1 {
        public final int version = 1;
        public final float pitch, yaw, roll, gazeX, gazeY, depth;
        public final boolean owned;
        public PoseV1(float pitch, float yaw, float roll, float gazeX, float gazeY, float depth, boolean owned) {
            this.pitch = pitch; this.yaw = yaw; this.roll = roll;
            this.gazeX = gazeX; this.gazeY = gazeY; this.depth = depth; this.owned = owned;
        }
        public static PoseV1 neutral() { return new PoseV1(0, 0, 0, 0, 0, 0, true); }
    }
}
