package com.zhanlv.lam.expression;

import java.text.BreakIterator;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Captured-motion port of AIBANLVKeyframeFace.swift at 2e75b5f.
 * Mutable state belongs to the host's serialized presentation owner.
 */
public final class KeyframeFacePlayer {
    private static final Pattern PERFORMANCE = Pattern.compile(
            "\\[perform[:\uff1a]([^\\]\\r\\n]{1,240})\\]", Pattern.CASE_INSENSITIVE);
    // Android 12 rejects UNICODE_CHARACTER_CLASS (256); spell out Unicode White_Space.
    private static final Pattern SENTENCE_END = Pattern.compile(
            "[\u3002\uff01\uff1f!?;\uff1b\\n]|[.](?:[\\u0009-\\u000d\\u0020\\u0085"
                    + "\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]|$)");
    private static final Pattern[] IGNORED_EMOTIONS = {
            Pattern.compile("[\u201c\u300c\u300e\"][^\u201d\u300d\u300f\"]*[\u201d\u300d\u300f\"]"),
            Pattern.compile("(?:\u5982\u679c|\u5047\u5982|\u8981\u662f|\u5e76\u4e0d\u662f|"
                    + "\u4e0d\u8981|\u4e0d\u7528|\u4e0d\u80fd|\u4e0d\u60f3|\u4e0d\u4f1a|"
                    + "\u6ca1\u6709|\u6ca1\u5f00|\u522b)[^\uff0c\u3002\uff01\uff1f!?\uff1b;]*"),
            Pattern.compile("[^\uff0c\u3002\uff01\uff1f!?\uff1b;]*\u7684\u8bdd[^\u3002\uff01\uff1f!?\uff1b;]*")
    };
    private static final String[][] ATTITUDES = {
            {"caring", "\u5b89\u6170", "\u9f13\u52b1"}, {"warm", "\u4eb2\u5207"},
            {"thinking", "\u601d\u8003"}, {"curious", "\u597d\u5947"},
            {"happy", "\u5f00\u5fc3"}, {"playful", "\u4fcf\u76ae"},
            {"surprised", "\u60ca\u8bb6"}, {"excited", "\u5174\u594b"},
            {"sad", "\u60b2\u4f24"}, {"angry", "\u6124\u6012"},
            {"fearful", "\u7d27\u5f20"}, {"disgusted", "\u538c\u6076"},
            {"neutral", "\u5e73\u9759"}
    };
    private static final String[] CARING = {
            "\u5b89\u6170", "\u5171\u60c5", "\u9f13\u52b1", "\u966a\u7740\u4f60",
            "\u652f\u6301\u4f60", "\u6162\u6162\u6765", "\u8f9b\u82e6",
            "\u542c\u8d77\u6765\u4f60", "\u52a0\u6cb9"
    };
    private static final String[][] EMOTION_RULES = {
            {"playful", "\u4fcf\u76ae", "\u8c03\u76ae", "\u9017\u4f60", "\u73a9\u7b11", "\u54c8\u54c8", "\u5c0f\u79d8\u5bc6"},
            {"curious", "\u597d\u5947", "\u60f3\u77e5\u9053", "\u544a\u8bc9\u6211", "\u63a2\u7d22", "\u7591\u95ee"},
            {"excited", "\u5174\u594b", "\u6fc0\u52a8", "\u6b22\u547c", "\u592a\u68d2\u4e86"},
            {"happy", "\u5f00\u5fc3", "\u9ad8\u5174", "\u795d\u8d3a", "\u606d\u559c", "\u5fae\u7b11", "\u7b11\u5bb9", "\u7b11\u4e00\u7b11"},
            {"warm", "\u4eb2\u5207", "\u6e29\u67d4", "\u6b22\u8fce", "\u4f60\u597d", "\u54c8\u55bd", "\u597d\u4e45\u4e0d\u89c1", "\u966a\u4f34", "\u653e\u677e", "hello", "good morning"},
            {"thinking", "\u601d\u8003", "\u5206\u6790", "\u60f3\u4e00\u60f3", "\u8ba9\u6211\u60f3", "\u6bd4\u8f83", "\u9009\u62e9", "\u72b9\u8c6b"},
            {"surprised", "\u60ca\u8bb6", "\u610f\u5916", "\u6ca1\u60f3\u5230", "\u5c45\u7136", "\u4e0d\u53ef\u601d\u8bae", "\u54c7"},
            {"sad", "\u60b2\u4f24", "\u9057\u61be", "\u5931\u843d", "\u4f24\u5fc3", "\u96be\u8fc7", "\u4e0d\u5f00\u5fc3"},
            {"angry", "\u6124\u6012", "\u4e0d\u6ee1", "\u751f\u6c14"},
            {"fearful", "\u7d27\u5f20", "\u5bb3\u6015", "\u62c5\u5fe7"},
            {"disgusted", "\u538c\u6076", "\u6076\u5fc3"}
    };
    private static final float[] HEAD_GAINS = {0.19f, 0.21f, 0.17f};
    private static final float[] HEAD_LIMITS = {0.16f, 0.22f, 0.12f};

    private final KeyframeFaceLibrary library;
    private final int[] rendererIndices;
    private final int[] headIndices;
    private final Map<String, Integer> variantCounters = new HashMap<>();
    private final List<String> recentClipIDs = new ArrayList<>();
    private final List<KeyframeFaceLibrary.Clip> playbackSequence = new ArrayList<>();
    private KeyframeFaceLibrary.Clip active;
    private int startFrame;
    private boolean explicitSelection;
    private final float[] overlay = new float[52];
    private float overlayWeight;
    private final float[] headOverlay = new float[3];
    private final float[] sampledHead = new float[3];
    private String semanticText = "";
    private boolean semanticCommitted;
    private String selectionReason = "legacy";
    private String playbackClipID = "none";

    /** A null library leaves sampling to the host's legacy/preset fallback. */
    public KeyframeFacePlayer(KeyframeFaceLibrary library) {
        this.library = library;
        rendererIndices = library == null ? new int[0] : library.rendererIndices();
        headIndices = library == null ? new int[0] : library.headIndices();
    }

    /** Keeps recency and transition history across adjacent replies. */
    public void beginTurn() {
        active = null;
        explicitSelection = false;
        semanticText = "";
        semanticCommitted = false;
        selectionReason = "pending-sentence";
        playbackClipID = "none";
    }

    public void reset() {
        beginTurn();
        recentClipIDs.clear();
        playbackSequence.clear();
        startFrame = 0;
        Arrays.fill(overlay, 0);
        overlayWeight = 0;
        Arrays.fill(headOverlay, 0);
        Arrays.fill(sampledHead, 0);
    }

    public boolean available() { return library != null; }

    public String clipID() { return active == null ? "none" : active.id; }

    public String playbackClipID() { return playbackClipID; }

    public String selectionReason() { return selectionReason; }

    /** Normalized pitch, yaw, roll from the most recent mix, returned by value. */
    public float[] sampledHead() { return sampledHead.clone(); }

    /** Returns true only when a different capture starts; repeated labels never restart it. */
    public boolean select(String emotion, String requestedID, boolean explicit, int frame) {
        if (library == null) return false;
        KeyframeFaceLibrary.Clip named = null;
        for (KeyframeFaceLibrary.Clip clip : library.clips) {
            if (clip.id.equals(requestedID)) { named = clip; break; }
        }
        if (explicitSelection && !explicit && named == null) return false;
        String normalized = "natural".equals(emotion) ? "neutral"
                : "thoughtful".equals(emotion) ? "thinking" : emotion;
        if (active != null && (named != null && named.id.equals(active.id)
                || named == null && active.emotion.equals(normalized))) {
            explicitSelection |= explicit;
            return false;
        }
        KeyframeFaceLibrary.Clip selected = named != null ? named : rotatedBest(normalized, null);
        if (selected == null) return false;
        active = selected;
        explicitSelection = explicit || named != null;
        startFrame = frame;
        remember(selected);
        return true;
    }

    /** Accumulates body deltas/prefixes; a delayed perform tag may replace sentence rules once. */
    public boolean selectSentence(String text, String body, int frame) {
        String intent = performance(text);
        if ((semanticCommitted || explicitSelection)
                && !(intent != null && "sentence-rules".equals(selectionReason))) return false;
        if (body == null) body = "";
        if (body.startsWith(semanticText)) semanticText = body;
        else if (!semanticText.endsWith(body)) semanticText += body;
        if (intent == null && !SENTENCE_END.matcher(semanticText).find()
                && characterBoundary(semanticText, 240) < 0) return false;
        String sentence = intent != null ? intent : semanticText;
        int end = characterBoundary(sentence, 1024);
        if (end >= 0) sentence = sentence.substring(0, end);
        String emotion = semanticEmotion(sentence, intent != null);
        KeyframeFaceLibrary.Clip selected = rotatedBest(emotion, sentence);
        boolean changed = select(emotion, selected == null ? null : selected.id, true, frame);
        semanticCommitted = true;
        selectionReason = intent == null ? "sentence-rules" : "performance-intent";
        return changed;
    }

    /** Raw renderer-order capture at a 30 Hz audio frame, or null without an active clip. */
    public float[] sample(int frame) {
        Motion motion = sampleMotion(frame);
        return motion == null ? null : rendererFrame(motion.raw);
    }

    /**
     * Stateful presentation step. The host advances it once per audio-clock step.
     * Source is renderer-order; articulation is copied bit-for-bit. The procedural
     * blink argument is intentionally ignored while captured motion owns the eyes.
     * Returns null without active motion or when source is not exactly 52 values.
     */
    public float[] mix(float[] rendererSource, int frame, int advance, float envelope, float blink) {
        if (rendererSource == null || rendererSource.length != 52) return null;
        Motion motion = sampleMotion(frame);
        if (motion == null) return null;
        float[] target = rendererFrame(motion.raw);
        float alpha = 1 - (float) Math.pow(0.65f, Math.max(1, advance));
        float weight = clamp(envelope, 0, 1) * motion.strength;
        overlayWeight += (weight - overlayWeight) * alpha;
        float[] result = rendererSource.clone();
        float articulationConflict = Math.min(1,
                Math.max(rendererSource[18], Math.max(rendererSource[19], rendererSource[20])));
        for (int index = 0; index < 52; index++) {
            boolean corners = index >= 23 && index <= 28;
            if (!(index <= 13 || corners || index >= 41 && index <= 50)) continue;
            boolean isBlink = index == 0 || index == 7;
            float regionWeight = corners ? 0.6f * (1 - 0.5f * articulationConflict) : 0.9f;
            float calibrated = target[index];
            if (isBlink && calibrated > 0.18f) {
                float x = clamp((calibrated - 0.18f) / 0.50f, 0, 1);
                // Keep Swift's left-associative Float rounding, including the gain.
                calibrated = 0.18f + 0.82f * x * x * (3 - 2 * x);
            }
            overlay[index] += (calibrated - overlay[index]) * (isBlink ? 1 : alpha);
            float w = overlayWeight * (isBlink ? 1 : regionWeight);
            float value = rendererSource[index] * (1 - w) + overlay[index] * w;
            result[index] = clamp(isBlink ? Math.max(value, rendererSource[index]) : value, 0, 1);
        }
        // A shallow eyelid mesh needs the wide/look morphs suppressed on the closed side.
        for (int base : new int[] {0, 7}) {
            float closure = smoothstep(clamp((result[base] - 0.30f) / 0.55f, 0, 1));
            if (closure <= 0) continue;
            result[base] = Math.max(result[base], 0.30f + 0.70f * closure);
            result[base + 6] *= 1 - closure;
            for (int look = base + 1; look <= base + 4; look++) result[look] *= 1 - closure;
            result[base + 5] = Math.max(result[base + 5], 0.10f * closure);
        }
        for (int axis = 0; axis < 3; axis++) {
            float delta = clamp(motion.head[axis], -HEAD_LIMITS[axis], HEAD_LIMITS[axis])
                    / HEAD_GAINS[axis];
            headOverlay[axis] += (delta - headOverlay[axis]) * alpha;
            float desired = headOverlay[axis] * overlayWeight;
            float maxStep = Math.min(3, Math.max(1, advance)) * 0.025f / HEAD_GAINS[axis];
            sampledHead[axis] += clamp(desired - sampledHead[axis], -maxStep, maxStep);
        }
        return result;
    }

    private Motion sampleMotion(int frame) {
        if (active == null) return null;
        double blend = 0.4;
        double[] strides = new double[playbackSequence.size()];
        double total = 0;
        for (int i = 0; i < strides.length; i++) {
            KeyframeFaceLibrary.Clip clip = playbackSequence.get(i);
            strides[i] = Math.max(1.0, (clip.frameCount() - 1) / clip.fps) - blend;
            total += strides[i];
        }
        double elapsed = Math.max(0L, (long) frame - startFrame) / 30.0;
        double local = elapsed % total;
        int index = 0;
        while (index < strides.length - 1 && local >= strides[index]) {
            local -= strides[index++];
        }
        Motion current = at(playbackSequence.get(index), local);
        playbackClipID = playbackSequence.get(index).id;
        float continuation = (float) Math.min(1, Math.max(0, (elapsed - strides[0]) / blend));
        float strength = 1 - 0.28f * continuation * continuation * (3 - 2 * continuation);
        if (local < blend && elapsed >= blend) {
            int previous = (index + strides.length - 1) % strides.length;
            Motion prior = at(playbackSequence.get(previous), strides[previous] + local);
            float t = smoothstep((float) (local / blend));
            for (int channel = 0; channel < current.raw.length; channel++) {
                current.raw[channel] = prior.raw[channel] * (1 - t) + current.raw[channel] * t;
            }
            for (int axis = 0; axis < 3; axis++) {
                current.head[axis] = prior.head[axis] * (1 - t) + current.head[axis] * t;
            }
        }
        return new Motion(current.raw, current.head, strength);
    }

    private Motion at(KeyframeFaceLibrary.Clip clip, double seconds) {
        double position = Math.min(clip.frameCount() - 1, Math.max(0, seconds) * clip.fps);
        int lo = (int) position, hi = Math.min(lo + 1, clip.frameCount() - 1);
        float t = (float) (position - lo);
        float[] raw = new float[61];
        for (int channel = 0; channel < raw.length; channel++) {
            raw[channel] = clip.frames[lo][channel] * (1 - t) + clip.frames[hi][channel] * t;
        }
        float[] head = new float[3];
        int restCount = Math.min(9, clip.frameCount());
        for (int axis = 0; axis < head.length; axis++) {
            int channel = headIndices[axis];
            float rest = 0;
            for (int i = 0; i < restCount; i++) rest += clip.frames[i][channel];
            head[axis] = raw[channel] - rest / restCount;
        }
        return new Motion(raw, head, 1);
    }

    private float[] rendererFrame(float[] raw) {
        float[] result = new float[52];
        for (int i = 0; i < result.length; i++) result[i] = raw[rendererIndices[i]];
        return result;
    }

    private static final class Motion {
        final float[] raw;
        final float[] head;
        final float strength;

        Motion(float[] raw, float[] head, float strength) {
            this.raw = raw;
            this.head = head;
            this.strength = strength;
        }
    }

    private static float clamp(float value, float low, float high) {
        return Math.min(high, Math.max(low, value));
    }

    private static float smoothstep(float value) {
        return value * value * (3 - 2 * value);
    }

    private static int characterBoundary(String text, int count) {
        BreakIterator characters = BreakIterator.getCharacterInstance(Locale.ROOT);
        characters.setText(text);
        int boundary = 0;
        for (int i = 0; i < count; i++) {
            boundary = characters.next();
            if (boundary == BreakIterator.DONE) return -1;
        }
        return boundary;
    }

    /** Extracts the first valid integrated performance tag, or null. */
    public static String performance(String text) {
        if (text == null) return null;
        Matcher match = PERFORMANCE.matcher(text);
        return match.find() ? match.group(1) : null;
    }

    public static String semanticEmotion(String sentence, boolean intent) {
        String text = sentence == null ? "" : sentence.toLowerCase(Locale.ROOT);
        if (intent) {
            int earliest = Integer.MAX_VALUE;
            String emotion = null;
            for (String[] rule : ATTITUDES) {
                for (int i = 1; i < rule.length; i++) {
                    int position = text.indexOf(rule[i]);
                    if (position >= 0 && position < earliest) {
                        earliest = position;
                        emotion = rule[0];
                    }
                }
            }
            if (emotion != null) return emotion;
        }
        for (Pattern ignored : IGNORED_EMOTIONS) text = ignored.matcher(text).replaceAll("");
        for (String word : CARING) if (text.contains(word)) return "caring";
        text = text.replace("\u4e0d\u5f00\u5fc3", "\u96be\u8fc7");
        String emotion = "neutral";
        int maximum = 0;
        for (String[] rule : EMOTION_RULES) {
            int score = 0;
            for (int i = 1; i < rule.length; i++) if (text.contains(rule[i])) score++;
            if (score > maximum) {
                maximum = score;
                emotion = rule[0];
            }
        }
        return emotion;
    }

    private int recencyPenalty(String id) {
        int index = recentClipIDs.lastIndexOf(id);
        return index < 0 ? 0 : Math.max(1, 8 - (recentClipIDs.size() - 1 - index));
    }

    private KeyframeFaceLibrary.Clip rotatedBest(String emotion, String sentence) {
        if (library == null) return null;
        int maximum = Integer.MIN_VALUE;
        List<KeyframeFaceLibrary.Clip> tied = new ArrayList<>();
        for (KeyframeFaceLibrary.Clip clip : library.clips) {
            if (!clip.emotion.equals(emotion)) continue;
            int semantic = 0;
            if (sentence != null && clip.semanticTags != null) {
                for (String tag : clip.semanticTags) if (sentence.contains(tag)) semantic++;
            }
            int score = semantic * 10 - recencyPenalty(clip.id);
            if (score > maximum) { maximum = score; tied.clear(); }
            if (score == maximum) tied.add(clip);
        }
        if (tied.isEmpty()) return null;
        tied.sort(Comparator.comparing(clip -> clip.id));
        int counter = variantCounters.getOrDefault(emotion, 0);
        variantCounters.put(emotion, counter + 1);
        return tied.get(Math.floorMod(counter, tied.size()));
    }

    private void remember(KeyframeFaceLibrary.Clip clip) {
        recentClipIDs.remove(clip.id);
        recentClipIDs.add(clip.id);
        if (recentClipIDs.size() > 8) recentClipIDs.remove(0);
        playbackSequence.clear();
        for (KeyframeFaceLibrary.Clip candidate : library.clips) {
            if (candidate.emotion.equals(clip.emotion) && !candidate.id.equals(clip.id)) {
                playbackSequence.add(candidate);
            }
        }
        playbackSequence.sort(Comparator
                .comparingInt((KeyframeFaceLibrary.Clip item) -> recencyPenalty(item.id))
                .thenComparing(item -> item.id));
        playbackSequence.add(0, clip);
    }
}
