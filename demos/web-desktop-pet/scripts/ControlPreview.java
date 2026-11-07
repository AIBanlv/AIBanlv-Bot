import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.zhanlv.digitalhuman.playback.ExpressionBehavior;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Demo-only transcript boundary; all canonical directive semantics stay in Control. */
public final class ControlPreview {
    public static ExpressionBehavior parse(String input) {
        if (input == null || input.codePointCount(0, input.length()) > 160
                || Pattern.compile("[\\x00-\\x08\\x0b-\\x1f]").matcher(input).find()) {
            throw new IllegalArgumentException("Expected 1-160 characters");
        }
        String normalized = input.replace('\u3010', '[').replace('\u3011', ']')
                .replace('\uff1a', ':');
        Matcher matcher = Pattern.compile("\\[([^\\[\\]<>]*)\\]|<([^\\[\\]<>]*)>").matcher(normalized);
        StringBuffer clean = new StringBuffer();
        StringBuilder canonical = new StringBuilder();
        Set<String> families = new HashSet<>();
        while (matcher.find()) {
            String body = (matcher.group(1) == null ? matcher.group(2) : matcher.group(1)).trim();
            String tag = "[" + alias(body) + "]";
            ExpressionBehavior parsed = ExpressionBehavior.fromText(tag);
            String family = parsed.emotion != null ? "emotion" : parsed.head != null ? "head"
                    : parsed.gaze != null ? "gaze" : parsed.depth != null ? "depth"
                    : parsed.clip != null ? "face" : !parsed.performance.isEmpty() ? "performance" : null;
            if (family == null) throw new IllegalArgumentException("Unknown behavior tag");
            if (!families.add(family)) throw new IllegalArgumentException("Repeated behavior category");
            canonical.append(tag);
            matcher.appendReplacement(clean, "");
        }
        matcher.appendTail(clean);
        String text = clean.toString().replaceAll("\\s+", " ").trim();
        if (text.isEmpty() || Pattern.compile("[\\[\\]<>]").matcher(text).find()
                || !Pattern.compile("[\\p{L}\\p{N}]").matcher(text).find()) {
            throw new IllegalArgumentException("Expected plain dialogue and complete tags");
        }
        ExpressionBehavior result = ExpressionBehavior.fromText(canonical.toString());
        result.text = text;
        result.inferMissing();
        return result;
    }

    private static String alias(String text) {
        switch (text) {
            case "\u6447\u5934": case "\u6447\u6447\u5934": return "H:shake";
            case "\u70b9\u5934": case "\u70b9\u70b9\u5934": return "H:nod";
            case "\u5fae\u7b11": case "\u5f00\u5fc3": return "E:happy";
            case "\u60ca\u8bb6": return "E:surprised";
            case "\u62ac\u5934": return "H:look_up";
            case "\u4f4e\u5934": return "H:look_down";
            case "\u5411\u5de6\u770b": return "H:look_left";
            case "\u5411\u53f3\u770b": return "H:look_right";
            default: return text;
        }
    }

    public static void main(String[] args) throws Exception {
        Gson gson = new Gson();
        JsonObject request = gson.fromJson(Files.readString(Paths.get(args[0])), JsonObject.class);
        JsonObject output = new JsonObject();
        try {
            output = gson.toJsonTree(parse(request.get("text").getAsString())).getAsJsonObject();
        } catch (IllegalArgumentException error) {
            output.addProperty("error", error.getMessage());
        }
        Files.writeString(Paths.get(args[1]), gson.toJson(output));
    }
}
