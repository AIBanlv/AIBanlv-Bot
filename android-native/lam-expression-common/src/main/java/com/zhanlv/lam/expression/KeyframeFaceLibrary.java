package com.zhanlv.lam.expression;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.TypeAdapter;
import com.google.gson.stream.JsonReader;
import com.google.gson.stream.JsonToken;
import java.io.IOException;
import java.io.StringReader;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Licensed captured motion, not on-device inference. Maps channels by name. */
public final class KeyframeFaceLibrary {
    private static final TypeAdapter<JsonElement> JSON = new Gson().getAdapter(JsonElement.class);
    private static final List<String> EMOTIONS = Collections.unmodifiableList(Arrays.asList(
            "neutral", "happy", "warm", "caring", "thinking", "surprised", "excited",
            "sad", "angry", "fearful", "disgusted", "curious", "playful"));
    private static final String[] POSE_NAMES = {
            "headyaw", "headpitch", "headroll", "lefteyeyaw", "lefteyepitch",
            "lefteyeroll", "righteyeyaw", "righteyepitch", "righteyeroll"
    };

    public final int schemaVersion;
    public final List<String> channels;
    public final List<Clip> clips;
    private final int[] rendererIndices;
    private final int[] headIndices;

    public static final class Clip {
        public final String id;
        public final String emotion;
        public final double fps;
        public final List<String> semanticTags;
        // Trusted common-package samplers may read these without copying each frame.
        final float[][] frames;

        private Clip(String id, String emotion, double fps, float[][] frames,
                List<String> semanticTags) {
            this.id = id;
            this.emotion = emotion;
            this.fps = fps;
            this.frames = frames;
            this.semanticTags = semanticTags == null ? null
                    : Collections.unmodifiableList(new ArrayList<>(semanticTags));
        }

        public int frameCount() { return frames.length; }

        public float[] frameAt(int index) { return frames[index].clone(); }
    }

    private KeyframeFaceLibrary(List<String> channels, List<String> names, List<Clip> clips) {
        schemaVersion = 1;
        this.channels = Collections.unmodifiableList(new ArrayList<>(channels));
        this.clips = Collections.unmodifiableList(new ArrayList<>(clips));
        rendererIndices = indices(names, rendererNames());
        headIndices = indices(names, new String[] {"headpitch", "headyaw", "headroll"});
    }

    /** Strict schema-v1 decoding. All malformed input throws IllegalArgumentException. */
    public static KeyframeFaceLibrary decode(String json) {
        if (json == null) throw invalid("Missing motion library");
        try (JsonReader reader = new JsonReader(new StringReader(json))) {
            reader.setLenient(false);
            JsonObject root = object(JSON.read(reader));
            if (reader.peek() != JsonToken.END_DOCUMENT) throw invalid("Trailing JSON");
            if (number(root.get("schemaVersion")) != 1) throw invalid("Invalid schema version");
            List<String> channels = strings(root.get("channels"));
            List<String> names = new ArrayList<>();
            for (String channel : channels) names.add(channel.toLowerCase(Locale.ROOT));
            Set<String> expected = new HashSet<>(Arrays.asList(rendererNames()));
            expected.addAll(Arrays.asList(POSE_NAMES));
            if (names.size() != 61 || !new HashSet<>(names).equals(expected)) {
                throw invalid("Invalid motion channels");
            }
            JsonArray items = array(root.get("clips"));
            if (items.size() < 1 || items.size() > 100) throw invalid("Invalid clip count");
            Set<String> ids = new HashSet<>();
            Set<String> poseNames = new HashSet<>(Arrays.asList(POSE_NAMES));
            List<Clip> clips = new ArrayList<>();
            for (JsonElement item : items) {
                JsonObject clip = object(item);
                String id = string(clip.get("id"));
                String emotion = string(clip.get("emotion"));
                double fps = number(clip.get("fps"));
                if (!id.matches("kf_[0-9]{4}|ss_[a-f0-9]{16}") || !ids.add(id)
                        || !EMOTIONS.contains(emotion) || fps < 15 || fps > 60) {
                    throw invalid("Invalid clip: " + id);
                }
                JsonArray rows = array(clip.get("frames"));
                if (rows.size() < 2 || rows.size() > 900) throw invalid("Invalid frames: " + id);
                float[][] frames = new float[rows.size()][61];
                for (int frame = 0; frame < rows.size(); frame++) {
                    JsonArray row = array(rows.get(frame));
                    if (row.size() != 61) throw invalid("Invalid frame width: " + id);
                    for (int channel = 0; channel < 61; channel++) {
                        double value = number(row.get(channel));
                        if (value > 1 || value < (poseNames.contains(names.get(channel)) ? -1 : 0)) {
                            throw invalid("Invalid frame value: " + id);
                        }
                        frames[frame][channel] = (float) value;
                    }
                }
                JsonElement tags = clip.get("semanticTags");
                clips.add(new Clip(id, emotion, fps, frames,
                        tags == null || tags.isJsonNull() ? null : strings(tags)));
            }
            return new KeyframeFaceLibrary(channels, names, clips);
        } catch (IOException | RuntimeException error) {
            throw new IllegalArgumentException("Invalid motion library", error);
        }
    }

    public int[] rendererIndices() { return rendererIndices.clone(); }

    /** Pose output order is pitch, yaw, roll, unlike the capture channel order. */
    public int[] headIndices() { return headIndices.clone(); }

    public static String[] rendererNames() {
        String[] names = new String[52];
        for (int i = 0; i < names.length; i++) {
            names[i] = ArkitChannels.nameAt(ArkitChannels.modelIndexAtRendererIndex(i))
                    .toLowerCase(Locale.ROOT);
        }
        return names;
    }

    public static String[] poseNames() { return POSE_NAMES.clone(); }

    private static int[] indices(List<String> names, String[] wanted) {
        int[] result = new int[wanted.length];
        for (int i = 0; i < wanted.length; i++) result[i] = names.indexOf(wanted[i]);
        return result;
    }

    private static JsonObject object(JsonElement value) {
        if (value == null || !value.isJsonObject()) throw invalid("Expected object");
        return value.getAsJsonObject();
    }

    private static JsonArray array(JsonElement value) {
        if (value == null || !value.isJsonArray()) throw invalid("Expected array");
        return value.getAsJsonArray();
    }

    private static String string(JsonElement value) {
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString()) {
            throw invalid("Expected string");
        }
        return value.getAsString();
    }

    private static List<String> strings(JsonElement value) {
        List<String> result = new ArrayList<>();
        for (JsonElement item : array(value)) result.add(string(item));
        return result;
    }

    private static double number(JsonElement value) {
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) {
            throw invalid("Expected finite number");
        }
        double result = value.getAsDouble();
        if (Double.isNaN(result) || Double.isInfinite(result)) throw invalid("Expected finite number");
        return result;
    }

    private static IllegalArgumentException invalid(String message) {
        return new IllegalArgumentException(message);
    }
}
