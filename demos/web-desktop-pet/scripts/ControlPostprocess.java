import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.zhanlv.digitalhuman.playback.AudioClockExpressionTimeline;
import com.zhanlv.digitalhuman.playback.ExpressionBehavior;
import com.zhanlv.lam.expression.ArkitChannels;
import com.zhanlv.lam.expression.IosExpressionProcessor;
import com.zhanlv.lam.expression.KeyframeFaceLibrary;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;

/** Offline caller of Control's unchanged production timeline, not a second algorithm. */
public final class ControlPostprocess {
    static JsonObject track(List<float[]> raw, KeyframeFaceLibrary library, String emotion, double duration) {
        ExpressionBehavior behavior = new ExpressionBehavior();
        behavior.emotion = emotion;
        behavior.explicitEmotion = true;
        behavior.head = "none";
        behavior.gaze = "contact";
        behavior.depth = "none";
        return track(raw, library, behavior, duration);
    }

    static JsonObject track(List<float[]> raw, KeyframeFaceLibrary library, ExpressionBehavior b, double duration) {
        AudioClockExpressionTimeline timeline = new AudioClockExpressionTimeline(
                new IosExpressionProcessor(library, new Random(20261017)::nextDouble));
        timeline.begin(1, 0);
        timeline.setListeningEnabled(false);
        timeline.setReply(1, b.emotion, b.explicitEmotion, b.clip, b.performance, b.text, b.head, b.gaze, b.depth);
        timeline.addAudio(1, (int) Math.round(duration * 16000));
        for (int start = 0; start < raw.size(); start += 30) {
            timeline.enqueue(1, raw.subList(start, Math.min(start + 30, raw.size())), 0);
        }
        timeline.endInput(1);
        timeline.startPlayback(1, 0, 0);
        JsonArray frames = new JsonArray(), poses = new JsonArray();
        for (int index = 0; index < raw.size(); index++) {
            long ms = (long) Math.ceil(index * 1000.0 / 30);
            append(timeline.sample(ms, ms), frames, poses);
        }
        long end = (long) Math.ceil(duration * 1000);
        timeline.complete(1, end, end);
        JsonArray closing = new JsonArray(), closingPoses = new JsonArray();
        for (int index = 0; index < 30; index++) {
            append(timeline.sample(end + (long) Math.ceil(index * 1000.0 / 30), end), closing, closingPoses);
        }
        JsonObject result = new JsonObject();
        result.add("frames", frames);
        result.add("poses", poses);
        result.add("closingFrames", closing);
        result.add("closingPoses", closingPoses);
        return result;
    }

    private static void append(IosExpressionProcessor.Output output, JsonArray frames, JsonArray poses) {
        float[] modelOrder = new float[52];
        for (int i = 0; i < 52; i++) modelOrder[ArkitChannels.modelIndexAtRendererIndex(i)] = output.frame[i];
        Gson gson = new Gson();
        frames.add(gson.toJsonTree(modelOrder));
        IosExpressionProcessor.PoseV1 p = output.pose;
        poses.add(gson.toJsonTree(new float[] {p.pitch, p.yaw, p.roll, p.gazeX, p.gazeY, p.depth}));
    }

    public static void main(String[] args) throws Exception {
        Gson gson = new Gson();
        JsonObject clip = gson.fromJson(Files.readString(Paths.get(args[0])), JsonObject.class);
        KeyframeFaceLibrary library = KeyframeFaceLibrary.decode(Files.readString(Paths.get(args[1])));
        JsonArray names = clip.getAsJsonArray("names");
        int[] mapping = new int[52];
        for (int i = 0; i < 52; i++) {
            mapping[i] = ArkitChannels.indexOf(names.get(i).getAsString());
            if (mapping[i] < 0) throw new IllegalArgumentException("Unknown ARKit channel");
        }
        List<float[]> raw = new ArrayList<>();
        for (JsonElement value : clip.getAsJsonArray("frames")) {
            float[] frame = new float[52];
            for (int i = 0; i < 52; i++) frame[mapping[i]] = value.getAsJsonArray().get(i).getAsFloat();
            raw.add(frame);
        }
        double duration = clip.get("duration").getAsDouble();
        JsonObject bank = new JsonObject(), variants = new JsonObject();
        String[][] presets = {{"natural", "natural"}, {"smile", "happy"},
                {"surprise", "surprised"}, {"focus", "thoughtful"}};
        if (args.length == 4) {
            ExpressionBehavior behavior = gson.fromJson(Files.readString(Paths.get(args[3])), ExpressionBehavior.class);
            variants.add("natural", track(raw, library, behavior, duration));
        } else {
            for (String[] preset : presets) variants.add(preset[0], track(raw, library, preset[1], duration));
        }
        bank.addProperty("version", 1);
        bank.addProperty("pipeline", IosExpressionProcessor.VERSION);
        bank.addProperty("fps", 30);
        bank.addProperty("duration", duration);
        bank.addProperty("seed", 20261017);
        bank.add("names", gson.toJsonTree(ArkitChannels.modelNames()));
        bank.add("variants", variants);
        Files.writeString(Paths.get(args[2]), gson.toJson(bank));
    }
}
