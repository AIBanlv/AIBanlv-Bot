import com.google.gson.Gson;
import com.google.gson.JsonArray;
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

public final class ControlLamStreamTest {
    public static void main(String[] args) throws Exception {
        KeyframeFaceLibrary library = KeyframeFaceLibrary.decode(Files.readString(Paths.get(args[0])));
        ControlLamStream stream = new ControlLamStream(library, new Random(20261017));
        List<float[]> raw = new ArrayList<>();
        for (int i = 0; i < 60; i++) {
            float[] frame = new float[52];
            frame[24] = .1f + .05f * (float) Math.sin(i * .2);
            frame[37] = .08f;
            raw.add(frame);
        }
        stream.reset();
        JsonObject first = stream.process(new Gson().toJsonTree(raw.subList(0, 30)).getAsJsonArray(), 24000);
        JsonObject second = stream.process(new Gson().toJsonTree(raw.subList(30, 60)).getAsJsonArray(), 24000);
        AudioClockExpressionTimeline reference = new AudioClockExpressionTimeline(
                new IosExpressionProcessor(library, new Random(20261017)::nextDouble));
        reference.begin(1, 0);
        reference.setListeningEnabled(false);
        setNativeReply(reference, 1, "", null);
        for (int block = 0; block < 2; block++) {
            reference.addAudio(1, 16000);
            reference.enqueue(1, raw.subList(block * 30, (block + 1) * 30), 0);
            reference.startPlayback(1, 0, 0);
            JsonObject actual = block == 0 ? first : second;
            for (int i = 0; i < 30; i++) {
                long ms = (long) Math.ceil((block * 30 + i) * 1000.0 / 30);
                assertOutput(actual, i, reference.sample(ms, ms), "Canonical streaming");
            }
        }
        JsonArray frames = first.getAsJsonArray("frames");
        if (frames.size() != 30 || frames.get(0).getAsJsonArray().size() != 52
                || second.getAsJsonArray("poses").size() != 30) throw new AssertionError("Invalid shape");
        if (frames.get(15).getAsJsonArray().get(24).getAsFloat() <= 0) throw new AssertionError("Jaw channel lost");
        JsonObject closing = stream.finish();
        if (closing.getAsJsonArray("frames").size() != 30) throw new AssertionError("Missing closing");
        stream.reset();
        JsonArray shortFrames = new Gson().toJsonTree(raw.subList(0, 1)).getAsJsonArray();
        if (stream.process(shortFrames, 1).getAsJsonArray("frames").size() != 1) throw new AssertionError("Partial frame lost");
        try {
            stream.process(shortFrames, 24000);
            throw new AssertionError("Wrong frame count accepted");
        } catch (IllegalArgumentException expectedFailure) {}
        replyMatchesNative(library, raw, "[E:surprise] Really?", null);
        replyMatchesNative(library, raw, "[\u60ca\u8bb6] \u771f\u7684\u5417\uff1f", null);
        replyMatchesNative(library, raw, "  [E:surprise]\n[H:look_left] <face:kf_0001> Really?  ", null);
        replyMatchesNative(library, raw, "[E:surprise] [H:look_left] Really?",
                "\u8bf7\u5411\u53f3\u770b\u5e76\u9760\u8fd1");
        replyMatchesNative(library, raw, "[E:surprise] [H:look_left] Really?",
                "\u4e0d\u8981\u5411\u53f3\u770b");
        successiveTurnsMatchNative(library, raw, true);
        successiveTurnsMatchNative(library, raw, false);
        replyBoundsAndState(library, raw);
        snapshotsMatchNative(library, raw);
        emptyAndPartialTurnsMatchNative(library, raw);
        System.out.println("PASS: 11 Control LAM scenarios (native reply, raw text, user overrides, "
                + "snapshots, bounds, RNG continuity, interrupted/empty/partial turns, canonical channels and closing)");
    }

    private static void replyMatchesNative(KeyframeFaceLibrary library, List<float[]> raw, String text, String userText) {
        ControlLamStream stream = new ControlLamStream(library, new Random(20261017));
        stream.reset();
        stream.reply(text, userText);
        ExpressionBehavior parsed = ExpressionBehavior.fromText(text);
        parsed.inferMissing();
        if (!"surprised".equals(parsed.emotion)) throw new AssertionError("Surprise fixture lost its meaning");
        JsonObject actual = stream.process(new Gson().toJsonTree(raw.subList(0, 30)).getAsJsonArray(), 24000);
        AudioClockExpressionTimeline reference = new AudioClockExpressionTimeline(
                new IosExpressionProcessor(library, new Random(20261017)::nextDouble));
        reference.begin(1, 0);
        reference.setListeningEnabled(false);
        setNativeReply(reference, 1, "", null);
        setNativeReply(reference, 1, text, userText);
        reference.addAudio(1, 16000);
        reference.enqueue(1, raw.subList(0, 30), 0);
        reference.startPlayback(1, 0, 0);
        for (int i = 0; i < 30; i++) {
            long ms = (long) Math.ceil(i * 1000.0 / 30);
            assertOutput(actual, i, reference.sample(ms, ms), "Native reply");
        }
    }

    private static void setNativeReply(AudioClockExpressionTimeline timeline, long generation, String text, String userText) {
        ExpressionBehavior behavior = ExpressionBehavior.fromText(text);
        behavior.inferMissing();
        ExpressionBehavior user = ExpressionBehavior.userMotion(userText);
        if (!"none".equals(user.head)) behavior.head = user.head;
        if (!"none".equals(user.gaze)) behavior.gaze = user.gaze;
        if (!"none".equals(user.depth)) behavior.depth = user.depth;
        if (!behavior.text.equals(text)) throw new AssertionError("Raw reply text was changed");
        timeline.setReply(generation, behavior.emotion, behavior.explicitEmotion, behavior.clip,
                behavior.performance, behavior.text, behavior.head, behavior.gaze, behavior.depth);
    }

    private static void successiveTurnsMatchNative(KeyframeFaceLibrary library, List<float[]> raw, boolean closing) {
        CountingRandom actualRandom = new CountingRandom();
        CountingRandom nativeRandom = new CountingRandom();
        ControlLamStream stream = new ControlLamStream(library, actualRandom);
        AudioClockExpressionTimeline reference = new AudioClockExpressionTimeline(
                new IosExpressionProcessor(library, nativeRandom::nextDouble));
        reference.setListeningEnabled(false);
        long offset = 0;
        for (long generation = 1; generation <= 3; generation++) {
            int beforeReset = actualRandom.calls;
            stream.reset();
            reference.begin(generation, offset);
            if (generation > 1 && actualRandom.calls != beforeReset) {
                throw new AssertionError("Reset reconstructed ambient RNG state");
            }
            setNativeReply(reference, generation, "", null);
            for (int block = 0; block < 2; block++) {
                List<float[]> input = raw.subList(block * 30, (block + 1) * 30);
                JsonObject actual = stream.process(new Gson().toJsonTree(input).getAsJsonArray(), 24000);
                reference.addAudio(generation, 16000);
                reference.enqueue(generation, input, 0);
                reference.startPlayback(generation, 0, offset);
                for (int i = 0; i < 30; i++) {
                    long ms = (long) Math.ceil((block * 30 + i) * 1000.0 / 30);
                    assertOutput(actual, i, reference.sample(offset + ms, ms),
                            "Turn " + generation + ", block " + block + ", closing " + closing);
                }
            }
            if (closing) {
                JsonObject actual = stream.finish();
                reference.endInput(generation);
                reference.complete(generation, offset + 2000, 2000);
                for (int i = 0; i < 30; i++) {
                    long ms = 2000 + (long) Math.ceil(i * 1000.0 / 30);
                    assertOutput(actual, i, reference.sample(offset + ms, 2000), "Closing turn " + generation);
                }
                offset += 1000;
            }
            offset += 2000;
            if (actualRandom.calls == 0 || actualRandom.calls != nativeRandom.calls) {
                throw new AssertionError("RNG diverged from persistent native processor");
            }
        }
    }

    private static void replyBoundsAndState(KeyframeFaceLibrary library, List<float[]> raw) {
        ControlLamStream stream = new ControlLamStream(library, new Random(20261017));
        rejects(() -> stream.reply("", null));
        rejects(stream::finish);
        stream.reset();
        stream.reply("x".repeat(16000), "y".repeat(1000));
        stream.reply("[E:surprise] Really?", null);
        rejects(() -> stream.reply(null, null));
        rejects(() -> stream.reply("x".repeat(16001), null));
        rejects(() -> stream.reply("[E:sad]", "y".repeat(1001)));
        ControlLamStream clean = new ControlLamStream(library, new Random(20261017));
        clean.reset();
        clean.reply("x".repeat(16000), "y".repeat(1000));
        clean.reply("[E:surprise] Really?", null);
        JsonArray frames = new Gson().toJsonTree(raw.subList(0, 30)).getAsJsonArray();
        String before = frames.toString();
        if (!stream.process(frames, 24000).equals(clean.process(frames, 24000))) {
            throw new AssertionError("Rejected reply mutated behavior");
        }
        if (!frames.toString().equals(before)) throw new AssertionError("Model input mutated");
        stream.finish();
        rejects(() -> stream.reply("", null));
        rejects(stream::finish);
        stream.reset();
        stream.reply("", "");
        if (stream.finish().getAsJsonArray("frames").size() != 0) throw new AssertionError("Empty turn fabricated frames");
    }

    private static void snapshotsMatchNative(KeyframeFaceLibrary library, List<float[]> raw) {
        ControlLamStream stream = new ControlLamStream(library, new Random(20261017));
        AudioClockExpressionTimeline reference = new AudioClockExpressionTimeline(
                new IosExpressionProcessor(library, new Random(20261017)::nextDouble));
        stream.reset();
        reference.begin(1, 0);
        reference.setListeningEnabled(false);
        setNativeReply(reference, 1, "", null);
        String[] snapshots = {"[E:surprise] Really?", "Really?", "[E:happy] Great!"};
        String user = "\u8bf7\u5411\u53f3\u770b";
        for (int block = 0; block < snapshots.length; block++) {
            stream.reply(snapshots[block], user);
            setNativeReply(reference, 1, snapshots[block], user);
            JsonObject actual = stream.process(new Gson().toJsonTree(raw.subList(0, 30)).getAsJsonArray(), 24000);
            reference.addAudio(1, 16000);
            reference.enqueue(1, raw.subList(0, 30), 0);
            reference.startPlayback(1, 0, 0);
            for (int i = 0; i < 30; i++) {
                long ms = (long) Math.ceil((block * 30 + i) * 1000.0 / 30);
                assertOutput(actual, i, reference.sample(ms, ms), "Streaming snapshot " + block);
            }
        }
    }

    private static void emptyAndPartialTurnsMatchNative(KeyframeFaceLibrary library, List<float[]> raw) {
        ControlLamStream stream = new ControlLamStream(library, new Random(20261017));
        AudioClockExpressionTimeline reference = new AudioClockExpressionTimeline(
                new IosExpressionProcessor(library, new Random(20261017)::nextDouble));
        reference.setListeningEnabled(false);
        for (long generation = 1; generation <= 3; generation++) {
            stream.reset();
            reference.begin(generation, generation - 1);
            setNativeReply(reference, generation, "", null);
            if (generation == 1) stream.finish();
        }
        JsonArray frame = new Gson().toJsonTree(raw.subList(0, 1)).getAsJsonArray();
        JsonObject actual = stream.process(frame, 1);
        reference.addAudio(3, 1);
        reference.enqueue(3, raw.subList(0, 1), 0);
        reference.startPlayback(3, 0, 2);
        assertOutput(actual, 0, reference.sample(2, 0), "Partial turn after empty resets");
        actual = stream.finish();
        reference.endInput(3);
        reference.complete(3, 3, 1);
        for (int i = 0; i < 30; i++) {
            assertOutput(actual, i, reference.sample(3 + (long) Math.ceil(i * 1000.0 / 30), 1), "Partial closing");
        }
        stream.reset();
        reference.begin(4, 1003);
        setNativeReply(reference, 4, "", null);
        actual = stream.process(frame, 1);
        reference.addAudio(4, 1);
        reference.enqueue(4, raw.subList(0, 1), 0);
        reference.startPlayback(4, 0, 1003);
        assertOutput(actual, 0, reference.sample(1003, 0), "Turn after partial closing");
    }

    private static void rejects(Runnable action) {
        try {
            action.run();
            throw new AssertionError("Invalid input or state accepted");
        } catch (IllegalArgumentException expected) {}
    }

    private static final class CountingRandom extends Random {
        int calls;
        CountingRandom() { super(20261017); }
        @Override public double nextDouble() { calls++; return super.nextDouble(); }
    }

    private static void assertOutput(JsonObject actual, int i, IosExpressionProcessor.Output expected, String context) {
        for (int renderer = 0; renderer < 52; renderer++) {
            int model = ArkitChannels.modelIndexAtRendererIndex(renderer);
            float value = actual.getAsJsonArray("frames").get(i).getAsJsonArray().get(model).getAsFloat();
            if (!Float.isFinite(value) || Math.abs(value - expected.frame[renderer]) > .000001f) {
                throw new AssertionError(context + ": face mismatch at " + i + ":" + model);
            }
        }
        float[] pose = {expected.pose.pitch, expected.pose.yaw, expected.pose.roll,
                expected.pose.gazeX, expected.pose.gazeY, expected.pose.depth};
        for (int p = 0; p < pose.length; p++) {
            float value = actual.getAsJsonArray("poses").get(i).getAsJsonArray().get(p).getAsFloat();
            if (!Float.isFinite(value) || Math.abs(value - pose[p]) > .000001f) throw new AssertionError(context + ": pose mismatch");
        }
    }
}
