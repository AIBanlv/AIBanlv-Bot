import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.zhanlv.digitalhuman.playback.AudioClockExpressionTimeline;
import com.zhanlv.digitalhuman.playback.ExpressionBehavior;
import com.zhanlv.lam.expression.ArkitChannels;
import com.zhanlv.lam.expression.IosExpressionProcessor;
import com.zhanlv.lam.expression.KeyframeFaceLibrary;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;

/** Stateful stream adapter; all articulation and pose algorithms remain in Control. */
public final class ControlLamStream {
    private static final Gson GSON = new Gson();
    private final AudioClockExpressionTimeline timeline;
    private long generation, timeOffsetMs, nextTimeMs;
    private long samples;
    private int frameIndex;
    private boolean ended, partial;

    ControlLamStream(KeyframeFaceLibrary library) { this(library, new Random()); }

    ControlLamStream(KeyframeFaceLibrary library, Random random) {
        timeline = new AudioClockExpressionTimeline(
                new IosExpressionProcessor(library, random::nextDouble));
        timeline.setListeningEnabled(false);
    }

    void reset() {
        // Audio time restarts per turn; presentation time and the native processor do not.
        if (generation != 0) timeOffsetMs = Math.max(timeOffsetMs + 1, nextTimeMs);
        timeline.begin(++generation, timeOffsetMs);
        samples = frameIndex = 0;
        ended = partial = false;
        reply("", null);
    }

    public void reply(String text, String userText) {
        if (generation == 0 || ended || text == null || text.length() > 16000
                || (userText != null && userText.length() > 1000)) {
            throw new IllegalArgumentException("Invalid reply");
        }
        ExpressionBehavior behavior = ExpressionBehavior.fromText(text);
        behavior.inferMissing();
        ExpressionBehavior user = ExpressionBehavior.userMotion(userText);
        if (!"none".equals(user.head)) behavior.head = user.head;
        if (!"none".equals(user.gaze)) behavior.gaze = user.gaze;
        if (!"none".equals(user.depth)) behavior.depth = user.depth;
        timeline.setReply(generation, behavior.emotion, behavior.explicitEmotion,
                behavior.clip, behavior.performance, behavior.text,
                behavior.head, behavior.gaze, behavior.depth);
    }

    JsonObject process(JsonArray values, int count) {
        if (generation == 0 || ended || partial || count <= 0 || count > 24000
                || values == null || values.size() != (count + 799) / 800
                || samples + count > 24000L * 180) throw new IllegalArgumentException("Invalid block");
        List<float[]> frames = new ArrayList<>();
        for (int i = 0; i < values.size(); i++) {
            JsonArray row = values.get(i).getAsJsonArray();
            if (row.size() != 52) throw new IllegalArgumentException("Invalid channels");
            float[] frame = new float[52];
            for (int j = 0; j < 52; j++) {
                frame[j] = row.get(j).getAsFloat();
                if (!Float.isFinite(frame[j]) || frame[j] < 0 || frame[j] > 1) {
                    throw new IllegalArgumentException("Invalid coefficient");
                }
            }
            frames.add(frame);
        }
        long previous16 = (samples * 2 + 2) / 3;
        samples += count;
        timeline.addAudio(generation, (int) ((samples * 2 + 2) / 3 - previous16));
        timeline.enqueue(generation, frames, 0);
        timeline.startPlayback(generation, 0, timeOffsetMs);
        JsonObject result = result();
        for (int i = 0; i < frames.size(); i++) {
            long ms = (long) Math.ceil(frameIndex++ * 1000.0 / 30);
            append(result, timeline.sample(timeOffsetMs + ms, ms));
        }
        nextTimeMs = timeOffsetMs + (long) Math.ceil(frameIndex * 1000.0 / 30);
        partial = count < 24000;
        return result;
    }

    JsonObject finish() {
        if (generation == 0 || ended) throw new IllegalArgumentException("Invalid finish");
        ended = true;
        JsonObject result = result();
        if (samples == 0) return result;
        long end = (samples * 1000 + 23999) / 24000;
        timeline.endInput(generation);
        timeline.complete(generation, timeOffsetMs + end, end);
        for (int i = 0; i < 30; i++) {
            append(result, timeline.sample(timeOffsetMs + end + (long) Math.ceil(i * 1000.0 / 30), end));
        }
        nextTimeMs = timeOffsetMs + end + 1000;
        return result;
    }

    private static JsonObject result() {
        JsonObject result = new JsonObject();
        result.addProperty("pipeline", IosExpressionProcessor.VERSION);
        result.addProperty("fps", 30);
        result.add("frames", new JsonArray());
        result.add("poses", new JsonArray());
        return result;
    }

    private static void append(JsonObject result, IosExpressionProcessor.Output output) {
        float[] model = new float[52];
        for (int i = 0; i < 52; i++) model[ArkitChannels.modelIndexAtRendererIndex(i)] = output.frame[i];
        result.getAsJsonArray("frames").add(GSON.toJsonTree(model));
        IosExpressionProcessor.PoseV1 p = output.pose;
        result.getAsJsonArray("poses").add(GSON.toJsonTree(new float[] {p.pitch, p.yaw, p.roll, p.gazeX, p.gazeY, p.depth}));
    }

    public static void main(String[] args) throws Exception {
        ControlLamStream stream = new ControlLamStream(KeyframeFaceLibrary.decode(Files.readString(Paths.get(args[0]))));
        JsonObject ready = new JsonObject();
        ready.addProperty("type", "ready");
        ready.addProperty("pipeline", IosExpressionProcessor.VERSION);
        ready.add("names", GSON.toJsonTree(ArkitChannels.modelNames()));
        System.out.println(GSON.toJson(ready));
        BufferedReader input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        for (;;) {
            StringBuilder line = new StringBuilder();
            int value;
            while ((value = input.read()) != -1 && value != '\n') {
                if (line.length() >= 160000) throw new IllegalArgumentException("Oversized request");
                line.append((char) value);
            }
            if (value == -1 && line.length() == 0) return;
            long id = 0;
            JsonObject result;
            try {
                JsonObject request = GSON.fromJson(line.toString(), JsonObject.class);
                id = request.get("id").getAsLong();
                if (id <= 0 || id > 9007199254740991L) throw new IllegalArgumentException("Invalid ID");
                switch (request.get("action").getAsString()) {
                    case "reset": stream.reset(); result = new JsonObject(); break;
                    case "reply":
                        stream.reply(textField(request, "text", false), textField(request, "userText", true));
                        result = new JsonObject(); break;
                    case "process": result = stream.process(request.getAsJsonArray("frames"), request.get("samples").getAsInt()); break;
                    case "finish": result = stream.finish(); break;
                    default: throw new IllegalArgumentException("Invalid action");
                }
            } catch (RuntimeException error) {
                result = new JsonObject(); result.addProperty("error", "INVALID_INPUT");
            }
            result.addProperty("id", id);
            System.out.println(GSON.toJson(result));
        }
    }

    private static String textField(JsonObject request, String key, boolean optional) {
        if (optional && (!request.has(key) || request.get(key).isJsonNull())) return null;
        if (!request.has(key) || !request.get(key).isJsonPrimitive()
                || !request.getAsJsonPrimitive(key).isString()) {
            throw new IllegalArgumentException("Invalid text");
        }
        return request.get(key).getAsString();
    }
}
