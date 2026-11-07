import com.zhanlv.digitalhuman.playback.AudioClockExpressionTimeline;
import com.zhanlv.lam.expression.ArkitChannels;
import com.zhanlv.lam.expression.IosExpressionProcessor;
import com.zhanlv.lam.expression.KeyframeFaceLibrary;
import com.google.gson.JsonObject;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;

public final class ControlPostprocessTest {
    public static void main(String[] args) throws Exception {
        KeyframeFaceLibrary library = KeyframeFaceLibrary.decode(Files.readString(Paths.get(args[0])));
        List<float[]> raw = new ArrayList<>();
        for (int i = 0; i < 90; i++) {
            float[] row = new float[52];
            row[24] = i == 35 ? .9f : .12f;
            row[43] = .015f;
            raw.add(row);
        }
        JsonObject actual = ControlPostprocess.track(raw, library, "happy", 3);
        AudioClockExpressionTimeline reference = new AudioClockExpressionTimeline(
                new IosExpressionProcessor(library, new Random(20261017)::nextDouble));
        reference.begin(1, 0);
        reference.setListeningEnabled(false);
        reference.setReply(1, "happy", true, null, "", "", "none", "contact", "none");
        reference.addAudio(1, 48000);
        for (int i = 0; i < 90; i += 30) reference.enqueue(1, raw.subList(i, i + 30), 0);
        reference.endInput(1);
        reference.startPlayback(1, 0, 0);
        for (int i = 0; i < 90; i++) {
            long ms = (long) Math.ceil(i * 1000.0 / 30);
            IosExpressionProcessor.Output expected = reference.sample(ms, ms);
            for (int renderer = 0; renderer < 52; renderer++) {
                int model = ArkitChannels.modelIndexAtRendererIndex(renderer);
                float value = actual.getAsJsonArray("frames").get(i).getAsJsonArray().get(model).getAsFloat();
                if (value != expected.frame[renderer]) throw new AssertionError("Frame mismatch " + i + ":" + model);
            }
            float pitch = actual.getAsJsonArray("poses").get(i).getAsJsonArray().get(0).getAsFloat();
            if (pitch != expected.pose.pitch) throw new AssertionError("Pose mismatch");
        }
        if (raw.get(35)[24] != .9f) throw new AssertionError("Raw input changed");
        if (actual.getAsJsonArray("closingFrames").size() != 30) throw new AssertionError("Closure missing");
        System.out.println("Control numeric parity: 90 x 52 exact, pose exact, original input preserved");
    }
}
