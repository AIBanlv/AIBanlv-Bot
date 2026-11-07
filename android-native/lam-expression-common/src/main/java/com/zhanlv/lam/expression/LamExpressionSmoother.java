package com.zhanlv.lam.expression;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Shared LAM mouth smoothing before app-specific natural motion and emotion effects. */
public final class LamExpressionSmoother {
    private static final int MAX_CONTEXT_FRAMES = 64;
    private static final int INITIAL_BLEND_FRAMES = 3;
    private static final int SUBSEQUENT_BLEND_FRAMES = 5;
    private static final float SILENCE_THRESHOLD = 0.001f;
    private static final int MIN_SILENCE_FRAMES = 7;
    private static final int[] MOUTH_INDICES = {
            27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38,
            39, 40, 41, 42, 43, 44, 45, 46, 47, 48,
            22, 23, 24, 25, 49, 50, 5
    };
    private static final int[][] SYMMETRIC_PAIRS = {
            {23, 25}, {32, 38}, {43, 44}, {29, 30}, {27, 28},
            {45, 46}, {35, 36}, {33, 34}, {47, 48}, {6, 7},
            {49, 50}, {0, 1}, {3, 4}, {8, 9}, {10, 11},
            {12, 13}, {14, 15}, {16, 17}, {18, 19}, {20, 21}
    };

    private final List<float[]> previousExpressions = new ArrayList<>();
    private final List<Float> previousVolumes = new ArrayList<>();
    private final boolean adaptSmallStreamingBatches;

    public LamExpressionSmoother(boolean adaptSmallStreamingBatches) {
        this.adaptSmallStreamingBatches = adaptSmallStreamingBatches;
    }

    /**
     * Effects receive the full context, current-batch start, and aligned audio RMS.
     * History is saved before effects so an emotion does not amplify on the next batch.
     */
    public synchronized List<float[]> process(
            List<float[]> rawFrames, float[] completedAudioSamples, Effect effect) {
        if (rawFrames == null || rawFrames.isEmpty()) return Collections.emptyList();
        List<float[]> newFrames = cloneFrames(rawFrames);
        float[] newVolumes = computeFrameRms(completedAudioSamples, newFrames.size());
        int processedFrames = previousExpressions.size();

        List<float[]> combined = new ArrayList<>(processedFrames + newFrames.size());
        combined.addAll(cloneFrames(previousExpressions));
        combined.addAll(newFrames);
        float[] combinedVolumes = new float[previousVolumes.size() + newVolumes.length];
        for (int index = 0; index < previousVolumes.size(); index++) {
            combinedVolumes[index] = previousVolumes.get(index);
        }
        System.arraycopy(newVolumes, 0, combinedVolumes, previousVolumes.size(), newVolumes.length);

        suppressSustainedSilence(combined, combinedVolumes, processedFrames);
        blendBatchBoundary(combined, processedFrames);
        combined = applyFiveFrameSavitzkyGolay(combined);
        symmetrize(combined);
        appendHistory(combined.subList(processedFrames, combined.size()), newVolumes);
        if (effect != null) effect.apply(combined, combinedVolumes, processedFrames);
        return cloneFrames(combined.subList(processedFrames, combined.size()));
    }

    public synchronized void reset() {
        previousExpressions.clear();
        previousVolumes.clear();
    }

    public interface Effect {
        void apply(List<float[]> frames, float[] volumes, int newFrameStart);
    }

    public static void symmetrize(List<float[]> frames) {
        for (float[] frame : frames) {
            for (int[] pair : SYMMETRIC_PAIRS) {
                float average = (frame[pair[0]] + frame[pair[1]]) * 0.5f;
                frame[pair[0]] = average;
                frame[pair[1]] = average;
            }
        }
    }

    private static List<float[]> cloneFrames(List<float[]> frames) {
        List<float[]> copies = new ArrayList<>(frames.size());
        for (float[] frame : frames) {
            if (frame == null || frame.length != ArkitChannels.count()) {
                throw new IllegalArgumentException("Expected one 52-value ARKit frame");
            }
            copies.add(frame.clone());
        }
        return copies;
    }

    private static float[] computeFrameRms(float[] audioSamples, int frameCount) {
        float[] rms = new float[frameCount];
        if (audioSamples == null || audioSamples.length == 0) return rms;
        for (int frame = 0; frame < frameCount; frame++) {
            int start = frame * audioSamples.length / frameCount;
            int end = (frame + 1) * audioSamples.length / frameCount;
            if (end <= start) end = Math.min(audioSamples.length, start + 1);
            double sumSquares = 0d;
            for (int sample = start; sample < end; sample++) {
                double value = audioSamples[sample];
                sumSquares += value * value;
            }
            rms[frame] = (float) Math.sqrt(sumSquares / Math.max(1, end - start));
        }
        return rms;
    }

    private static void suppressSustainedSilence(
            List<float[]> frames, float[] volumes, int processedFrames) {
        int regionStart = -1;
        for (int index = 0; index <= volumes.length; index++) {
            boolean silent = index < volumes.length && volumes[index] < SILENCE_THRESHOLD;
            if (silent && regionStart < 0) regionStart = index;
            if ((!silent || index == volumes.length) && regionStart >= 0) {
                int regionEndExclusive = index;
                if (regionEndExclusive - regionStart >= MIN_SILENCE_FRAMES) {
                    for (int frameIndex = regionStart; frameIndex < regionEndExclusive; frameIndex++) {
                        float[] frame = frames.get(frameIndex);
                        for (int mouthIndex : MOUTH_INDICES) frame[mouthIndex] *= 0.1f;
                    }
                    blendSilenceStart(frames, regionStart, processedFrames);
                    blendSilenceEnd(frames, regionEndExclusive - 1);
                }
                regionStart = -1;
            }
        }
    }

    private static void blendSilenceStart(
            List<float[]> frames, int regionStart, int processedFrames) {
        int blendLength = Math.min(3, regionStart - processedFrames);
        if (blendLength <= 0 || regionStart == 0) return;
        float[] reference = frames.get(regionStart - 1).clone();
        for (int offset = 0; offset < blendLength; offset++) {
            blendFrame(frames.get(regionStart + offset), reference,
                    (offset + 1f) / (blendLength + 1f));
        }
    }

    private static void blendSilenceEnd(List<float[]> frames, int regionEnd) {
        int blendLength = Math.min(3, frames.size() - regionEnd - 1);
        if (blendLength <= 0) return;
        float[] reference = frames.get(regionEnd + 1).clone();
        for (int offset = 0; offset < blendLength; offset++) {
            blendFrame(frames.get(regionEnd - offset), reference,
                    (offset + 1f) / (blendLength + 1f));
        }
    }

    private void blendBatchBoundary(List<float[]> frames, int processedFrames) {
        int newFrameCount = frames.size() - processedFrames;
        int blendWindow;
        if (processedFrames > 0 && adaptSmallStreamingBatches) {
            blendWindow = Math.min(SUBSEQUENT_BLEND_FRAMES, Math.max(1, newFrameCount / 3));
        } else if (processedFrames > 0) {
            blendWindow = SUBSEQUENT_BLEND_FRAMES;
        } else {
            blendWindow = INITIAL_BLEND_FRAMES;
        }
        int blendLength = Math.min(blendWindow, newFrameCount);
        if (blendLength <= 0) return;
        float[] reference = processedFrames > 0
                ? frames.get(processedFrames - 1).clone()
                : new float[ArkitChannels.count()];
        for (int offset = 0; offset < blendLength; offset++) {
            blendFrame(frames.get(processedFrames + offset), reference,
                    (offset + 1f) / (blendLength + 1f));
        }
    }

    private static void blendFrame(float[] target, float[] reference, float weight) {
        for (int channel = 0; channel < target.length; channel++) {
            target[channel] = reference[channel] * (1f - weight) + target[channel] * weight;
        }
    }

    private static List<float[]> applyFiveFrameSavitzkyGolay(List<float[]> frames) {
        if (frames.size() < 5) return cloneFrames(frames);
        float[] coefficients = {-3f / 35f, 12f / 35f, 17f / 35f, 12f / 35f, -3f / 35f};
        List<float[]> smoothed = new ArrayList<>(frames.size());
        for (int frameIndex = 0; frameIndex < frames.size(); frameIndex++) {
            float[] output = new float[ArkitChannels.count()];
            for (int coefficientIndex = 0; coefficientIndex < coefficients.length; coefficientIndex++) {
                int offset = coefficientIndex - 2;
                float[] source = frames.get(mirrorIndex(frameIndex + offset, frames.size()));
                float coefficient = coefficients[coefficientIndex];
                for (int channel = 0; channel < output.length; channel++) {
                    output[channel] += source[channel] * coefficient;
                }
            }
            for (int channel = 0; channel < output.length; channel++) {
                output[channel] = clamp01(output[channel]);
            }
            smoothed.add(output);
        }
        return smoothed;
    }

    private static int mirrorIndex(int index, int length) {
        int mirrored = index;
        while (mirrored < 0 || mirrored >= length) {
            if (mirrored < 0) mirrored = -mirrored;
            else mirrored = 2 * length - mirrored - 2;
        }
        return mirrored;
    }

    private void appendHistory(List<float[]> processedNewFrames, float[] newVolumes) {
        previousExpressions.addAll(cloneFrames(processedNewFrames));
        for (float volume : newVolumes) previousVolumes.add(volume);
        while (previousExpressions.size() > MAX_CONTEXT_FRAMES) previousExpressions.remove(0);
        while (previousVolumes.size() > MAX_CONTEXT_FRAMES) previousVolumes.remove(0);
    }

    private static float clamp01(float value) {
        return Math.max(0f, Math.min(1f, value));
    }
}
