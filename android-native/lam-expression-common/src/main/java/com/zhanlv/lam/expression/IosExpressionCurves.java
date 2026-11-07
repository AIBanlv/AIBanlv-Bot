package com.zhanlv.lam.expression;

/**
 * Pure curves from AIBANLVDigitalHumanLamEngine.swift, origin/ios-plugin 2e75b5f.
 * Inputs are validated by the caller; all face arrays except model input use renderer order.
 */
public final class IosExpressionCurves {
    private static final int[] PRIMARY_MOUTH_MODEL_INDICES = {
            22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37,
            38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 5
    };

    private IosExpressionCurves() {}

    public static float[] remapWithWeakMouthGain(float[] model) {
        float[] adjusted = model.clone();
        float mouthPeak = 0;
        for (int index : PRIMARY_MOUTH_MODEL_INDICES) {
            mouthPeak = Math.max(mouthPeak, Math.abs(adjusted[index]));
        }
        if (mouthPeak > 0 && mouthPeak < .02f) {
            float maxGain = mouthPeak < .0015f ? 45 : 18;
            float gain = Math.min(maxGain, Math.max(1, .22f / mouthPeak));
            if (gain > 1) {
                for (int index : PRIMARY_MOUTH_MODEL_INDICES) {
                    adjusted[index] = Math.min(1, Math.max(0, adjusted[index] * gain));
                }
            }
        }
        float[] result = new float[52];
        for (int i = 0; i < result.length; i++) {
            result[i] = adjusted[ArkitChannels.modelIndexAtRendererIndex(i)];
        }
        return result;
    }

    public static float[] preset(float[] source, String preset, int ordinal,
            float blink, float envelope, String gaze) {
        float[] frame = source.clone();
        float slowPulse = (float) ((Math.sin(ordinal * .115) + 1) * .5);
        float strength = envelope * (.78f + slowPulse * .22f) * intensity(preset);
        float asymmetry = (float) Math.sin(ordinal * .071) * .024f;
        if ("natural".equals(preset) || "happy".equals(preset) || "excited".equals(preset)
                || "warm".equals(preset) || "caring".equals(preset)) {
            raise(frame, 23, (.04f + slowPulse * .025f + Math.max(0, asymmetry)) * envelope);
            raise(frame, 24, (.04f + slowPulse * .025f + Math.max(0, -asymmetry)) * envelope);
        }
        raise(frame, 43, (.028f + slowPulse * .025f) * envelope);
        raise(frame, 44, (.045f + slowPulse * .035f + Math.max(0, asymmetry)) * envelope);
        raise(frame, 45, (.045f + slowPulse * .035f + Math.max(0, -asymmetry)) * envelope);
        raise(frame, 47, (.04f + slowPulse * .035f) * envelope);
        raise(frame, 48, (.04f + (1 - slowPulse) * .035f) * envelope);
        switch (preset) {
            case "happy":
                raise(frame, 23, (.25f + Math.max(0, asymmetry)) * strength);
                raise(frame, 24, (.25f + Math.max(0, -asymmetry)) * strength);
                raisePair(frame, 27, 28, .13f * strength);
                raisePair(frame, 47, 48, .14f * strength);
                raisePair(frame, 44, 45, .08f * strength);
                break;
            case "excited":
                raisePair(frame, 23, 24, .31f * strength);
                raisePair(frame, 27, 28, .16f * strength);
                raisePair(frame, 6, 13, .12f * strength);
                raisePair(frame, 44, 45, .17f * strength);
                raisePair(frame, 47, 48, .18f * strength);
                break;
            case "warm":
                raisePair(frame, 23, 24, .16f * strength);
                raisePair(frame, 44, 45, .07f * strength);
                raisePair(frame, 47, 48, .12f * strength);
                raisePair(frame, 5, 12, .08f * strength);
                break;
            case "caring":
                raisePair(frame, 23, 24, .1f * strength);
                raise(frame, 43, .1f * strength);
                raisePair(frame, 44, 45, .075f * strength);
                raisePair(frame, 5, 12, .11f * strength);
                break;
            case "surprised":
                raisePair(frame, 6, 13, .27f * strength);
                raise(frame, 43, .29f * strength);
                raisePair(frame, 44, 45, .16f * strength);
                break;
            case "sad":
                raisePair(frame, 25, 26, .22f * strength);
                raise(frame, 43, .16f * strength);
                raisePair(frame, 41, 42, .075f * strength);
                break;
            case "disgusted":
                raisePair(frame, 41, 42, .18f * strength);
                raisePair(frame, 49, 50, .24f * strength);
                raisePair(frame, 25, 26, .1f * strength);
                raisePair(frame, 39, 40, .08f * strength);
                break;
            case "angry":
                raisePair(frame, 41, 42, .3f * strength);
                raisePair(frame, 5, 12, .13f * strength);
                raisePair(frame, 35, 36, .15f * strength);
                raisePair(frame, 49, 50, .1f * strength);
                break;
            case "fearful":
                raisePair(frame, 6, 13, .24f * strength);
                raise(frame, 43, .25f * strength);
                raisePair(frame, 44, 45, .16f * strength);
                raisePair(frame, 25, 26, .11f * strength);
                raisePair(frame, 29, 30, .1f * strength);
                break;
            case "thoughtful":
                raise(frame, 41, (.1f + Math.max(0, asymmetry)) * strength);
                raise(frame, 42, (.1f + Math.max(0, -asymmetry)) * strength);
                raise(frame, 43, .14f * strength);
                raisePair(frame, 12, 5, .06f * strength);
                break;
            default:
                raise(frame, 5, (.052f + slowPulse * .026f + Math.max(0, asymmetry)) * envelope);
                raise(frame, 12, (.052f + (1 - slowPulse) * .026f + Math.max(0, -asymmetry)) * envelope);
                raisePair(frame, 6, 13, slowPulse > .72f ? .022f * envelope : 0);
                break;
        }
        switch (gaze) {
            case "gentle":
                raisePair(frame, 5, 12, .17f * envelope);
                raisePair(frame, 47, 48, .1f * envelope);
                break;
            case "soft":
                raisePair(frame, 5, 12, .26f * envelope);
                break;
            case "thinking":
                raisePair(frame, 4, 11, .26f * envelope);
                raisePair(frame, 3, 9, .1f * envelope);
                break;
            case "lower":
                raisePair(frame, 1, 8, .26f * envelope);
                break;
            default:
                break;
        }
        if (blink > 0) {
            frame[0] = Math.min(1, Math.max(frame[0], blink));
            frame[7] = Math.min(1, Math.max(frame[7], blink));
            raisePair(frame, 5, 12, blink * .12f);
        }
        for (int i = 0; i < 52; i++) {
            if (articulation(i)) frame[i] = source[i];
        }
        return frame;
    }

    /** Mutates previous with overlay deltas only, never enhanced model samples. */
    public static float[] smoothOverlay(float[] source, float[] target, float[] previous, int advance) {
        float[] result = source.clone();
        for (int i = 0; i < source.length; i++) {
            boolean allowed = i <= 13 || i >= 23 && i <= 28 || i >= 41 && i <= 50;
            if (!allowed) {
                previous[i] = 0;
                continue;
            }
            float delta = Math.max(0, target[i] - source[i]);
            float rate = i == 0 || i == 7 ? .84f : gazeChannel(i) ? .55f : .22f;
            float alpha = 1 - (float) Math.pow(1 - rate, (float) Math.max(1, advance));
            previous[i] += (delta - previous[i]) * alpha;
            result[i] = Math.min(1, Math.max(0, source[i] + previous[i]));
        }
        return result;
    }

    public static PlannedMotion planned(int ordinal, int audioFrames, boolean ended, String head, String gaze) {
        int totalFrames = Math.max(ordinal + 1, Math.max(1, audioFrames));
        int enterFrames = Math.min(30, Math.max(7, totalFrames));
        int exitFrames = Math.min(60, Math.max(10, totalFrames / 4));
        float enterProgress = Math.min(1, (float) (ordinal + 1) / enterFrames);
        float envelope = smoothStep(enterProgress);
        int remaining = Math.max(0, totalFrames - ordinal);
        if (ended && remaining <= exitFrames) {
            envelope *= smoothStep((float) remaining / exitFrames);
        }
        String phase = ended && remaining <= exitFrames ? "decay" : enterProgress < 1 ? "enter" : "peak";
        double seconds = ordinal / 30.0;
        float behaviorEnvelope = smoothStep(Math.min(1, (float) (ordinal + 1) / 8));
        if (ended && remaining <= exitFrames) {
            behaviorEnvelope *= smoothStep((float) remaining / exitFrames);
        }
        float pitch = 0, yaw = 0, roll = 0;
        switch (head) {
            case "nod":
                if (seconds < .95) pitch = (float) Math.sin(seconds / .95 * Math.PI * 2) * .78f * behaviorEnvelope;
                break;
            case "slow_nod":
                if (seconds < 1.65) pitch = (float) Math.sin(seconds / 1.65 * Math.PI * 2) * .68f * behaviorEnvelope;
                break;
            case "tilt":
                roll = .58f * smoothStep((float) Math.min(1, seconds / .7)) * behaviorEnvelope;
                break;
            case "shake":
                if (seconds < 1.2) {
                    yaw = (float) Math.sin(seconds * Math.PI * 4.4) * .8f
                            * (float) (1 - seconds / 1.2) * behaviorEnvelope;
                }
                break;
            case "lean":
                pitch = -.46f * smoothStep((float) Math.min(1, seconds / .8)) * behaviorEnvelope;
                break;
            case "look_up":
                pitch = -.62f * smoothStep((float) Math.min(1, seconds / .55)) * behaviorEnvelope;
                break;
            case "look_down":
                pitch = .48f * smoothStep((float) Math.min(1, seconds / .55)) * behaviorEnvelope;
                break;
            case "look_left":
                yaw = .62f * smoothStep((float) Math.min(1, seconds / .55)) * behaviorEnvelope;
                break;
            case "look_right":
                yaw = -.62f * smoothStep((float) Math.min(1, seconds / .55)) * behaviorEnvelope;
                break;
            default:
                break;
        }
        double beat = seconds % 4.6;
        if (seconds > 4.6 && beat < .8 && !"none".equals(head)) {
            pitch += (float) Math.sin(beat / .8 * Math.PI * 2) * .12f * behaviorEnvelope;
        }
        float gazeX = 0, gazeY = 0;
        switch (gaze) {
            case "contact":
                gazeX = (float) Math.sin(seconds * 1.37) * .14f * behaviorEnvelope;
                gazeY = (float) Math.sin(seconds * .79 + .65) * .06f * behaviorEnvelope;
                break;
            case "gentle":
                gazeX = (float) Math.sin(seconds * .93 + .4) * .11f * behaviorEnvelope;
                gazeY = (.09f + (float) Math.sin(seconds * .61) * .035f) * behaviorEnvelope;
                break;
            case "soft":
                gazeX = (float) Math.sin(seconds * .82 + .85) * .1f * behaviorEnvelope;
                gazeY = (.17f + (float) Math.sin(seconds * .57 + .3) * .04f) * behaviorEnvelope;
                break;
            case "thinking":
                gazeX = .28f * behaviorEnvelope;
                gazeY = -.3f * behaviorEnvelope;
                break;
            case "lower": gazeY = .34f * behaviorEnvelope; break;
            case "up": gazeY = -.38f * behaviorEnvelope; break;
            case "left": gazeX = -.38f * behaviorEnvelope; break;
            case "right": gazeX = .38f * behaviorEnvelope; break;
            default: break;
        }
        return new PlannedMotion(envelope, phase, pitch, yaw, roll, gazeX, gazeY);
    }

    public static float smoothStep(float value) {
        float t = Math.min(1, Math.max(0, value));
        return t * t * (3 - 2 * t);
    }

    public static final class PlannedMotion {
        public final float envelope;
        public final String phase;
        public final float pitch, yaw, roll, gazeX, gazeY;

        private PlannedMotion(float envelope, String phase, float pitch, float yaw,
                float roll, float gazeX, float gazeY) {
            this.envelope = envelope;
            this.phase = phase;
            this.pitch = pitch;
            this.yaw = yaw;
            this.roll = roll;
            this.gazeX = gazeX;
            this.gazeY = gazeY;
        }
    }

    private static float intensity(String preset) {
        switch (preset) {
            case "excited": return 1.55f;
            case "surprised": case "angry": case "fearful": case "disgusted": return 1.45f;
            case "happy": return 1.38f;
            case "warm": case "caring": case "sad": return 1.32f;
            case "thoughtful": return 1.28f;
            default: return 1.18f;
        }
    }

    static boolean articulation(int i) {
        return i >= 14 && i <= 22 || i >= 29 && i <= 40 || i == 51;
    }

    static boolean gazeChannel(int i) {
        return i >= 1 && i <= 4 || i >= 8 && i <= 11;
    }

    private static void raise(float[] frame, int index, float amount) {
        if (index < frame.length) frame[index] = Math.min(1, Math.max(0, frame[index] + amount));
    }

    private static void raisePair(float[] frame, int left, int right, float amount) {
        raise(frame, left, amount);
        raise(frame, right, amount);
    }
}
