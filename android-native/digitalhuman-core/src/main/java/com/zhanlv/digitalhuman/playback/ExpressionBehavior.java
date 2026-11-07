package com.zhanlv.digitalhuman.playback;

import com.google.gson.JsonElement;
import com.google.gson.JsonParser;
import com.zhanlv.lam.expression.KeyframeFacePlayer;
import java.util.Arrays;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Boundary parser for out-of-band behavior and iOS textual directives. No transcript mutation. */
public final class ExpressionBehavior {
    public String text = "", performance = "", emotion;
    public String clip, head, gaze, depth;
    public boolean explicitEmotion;

    public static ExpressionBehavior parse(String json) {
        if (json == null || json.length() > 65536) throw new IllegalArgumentException("Invalid metadata size");
        try {
            JsonElement root = new JsonParser().parse(json);
            if (!root.isJsonObject()) throw new IllegalArgumentException("Metadata object required");
            ExpressionBehavior result = new ExpressionBehavior();
            collect(root, "", 0, result);
            ExpressionBehavior tags = fromText(result.text);
            result.performance = result.performance.isEmpty() ? tags.performance : result.performance;
            if (result.clip == null) result.clip = tags.clip;
            if (result.emotion == null) {
                result.emotion = tags.emotion; result.explicitEmotion = tags.explicitEmotion;
            }
            if (result.head == null) result.head = tags.head;
            if (result.gaze == null) result.gaze = tags.gaze;
            if (result.depth == null) result.depth = tags.depth;
            return result;
        } catch (RuntimeException error) {
            throw new IllegalArgumentException("Invalid expression metadata", error);
        }
    }

    private static void collect(JsonElement value, String key, int level, ExpressionBehavior out) {
        if (value == null || value.isJsonNull() || level > 6) return;
        if (value.isJsonObject()) {
            for (Map.Entry<String, JsonElement> entry : value.getAsJsonObject().entrySet()) {
                collect(entry.getValue(), entry.getKey().toLowerCase(Locale.ROOT), level + 1, out);
            }
        } else if (value.isJsonArray()) {
            for (JsonElement child : value.getAsJsonArray()) collect(child, key, level + 1, out);
        } else if (value.isJsonPrimitive() && value.getAsJsonPrimitive().isString()) {
            String s = value.getAsString().trim();
            switch (key) {
                case "text": case "content": case "transcript": case "sentence":
                    if (!s.isEmpty()) out.text += (out.text.isEmpty() ? "" : " ") + s;
                    break;
                case "performance": case "expression_intent": out.performance = s; break;
                case "faceclip": case "face_clip":
                    if (s.matches("kf_[0-9]{4}")) out.clip = s;
                    break;
                case "emotion": case "mood": case "sentiment": case "expression":
                    String e = emotion(s);
                    if (e != null) { out.emotion = e; out.explicitEmotion = true; }
                    break;
                case "head": out.head = allowed(s, HEADS); break;
                case "eye": case "gaze": out.gaze = allowed(s, GAZES); break;
                case "depth": out.depth = allowed(s, DEPTHS); break;
                case "behavior":
                    ExpressionBehavior tags = fromText(s);
                    if (tags.explicitEmotion) { out.emotion = tags.emotion; out.explicitEmotion = true; }
                    if (tags.head != null) out.head = tags.head;
                    if (tags.gaze != null) out.gaze = tags.gaze;
                    break;
                default: break;
            }
        }
    }

    public static ExpressionBehavior fromText(String text) {
        ExpressionBehavior result = new ExpressionBehavior();
        result.text = text == null ? "" : text;
        String normalized = result.text.replace('【', '[').replace('】', ']').replace('：', ':');
        result.emotion = emotion(tag(normalized, "E|emotion"));
        result.explicitEmotion = result.emotion != null;
        result.head = allowed(tag(normalized, "H|head"), HEADS);
        result.gaze = allowed(tag(normalized, "G|eye|gaze"), GAZES);
        result.depth = allowed(tag(normalized, "depth"), DEPTHS);
        String clip = tag(normalized, "face");
        if (clip != null && clip.matches("kf_[0-9]{4}")) result.clip = clip;
        String performance = KeyframeFacePlayer.performance(normalized);
        if (performance != null) result.performance = performance;
        return result;
    }

    public static ExpressionBehavior userMotion(String text) {
        ExpressionBehavior b = new ExpressionBehavior();
        b.head = b.gaze = b.depth = "none";
        String s = text == null ? "" : text.toLowerCase(Locale.ROOT).replace(" ", "");
        boolean question = any(s, "吗", "能不能", "可不可以", "能否", "couldyou", "canyou");
        if (!question && any(s, "无法", "不能", "不可以", "做不到", "cannot", "can't", "不要", "别")) return b;
        if (any(s, "摇摇头", "摇头", "shakehead")) { b.head = "shake"; b.gaze = "contact"; }
        else if (any(s, "点点头", "点头", "nod")) { b.head = "nod"; b.gaze = "contact"; }
        else if (any(s, "抬起头", "抬头", "仰头", "看向天空", "lookup")) { b.head = "look_up"; b.gaze = "up"; }
        else if (any(s, "低下头", "低头", "向下看", "lookdown")) { b.head = "look_down"; b.gaze = "lower"; }
        else if (any(s, "向左看", "看左边", "看向左", "向左转", "往左转", "左转", "转向左", "朝左", "左边看看", "往左边看", "lookleft", "turnleft")) { b.head = "look_left"; b.gaze = "left"; }
        else if (any(s, "向右看", "看右边", "看向右", "向右转", "往右转", "右转", "转向右", "朝右", "右边看看", "往右边看", "lookright", "turnright")) { b.head = "look_right"; b.gaze = "right"; }
        if (any(s, "前后移动", "前后动", "来回移动", "来回走", "movebackandforth")) b.depth = "cycle";
        else if (!any(s, "往后看", "向后看", "看后面", "看背后", "回头看")
                && any(s, "往后退", "向后退", "后退", "退后", "往后一点", "向后一点", "退远", "远一点", "离远", "离我远", "往后走", "向后走", "后移", "往后可以", "moveback")) b.depth = "back";
        else if (any(s, "靠近", "靠过来", "靠近点", "往前靠", "向前靠", "往前凑", "向前凑", "凑近", "近一点", "走近", "上前", "往前走", "向前走", "往前一点", "向前移动", "前移", "comecloser", "moveforward")) b.depth = "forward";
        return b;
    }

    public void inferMissing() {
        if (emotion == null) emotion = KeyframeFacePlayer.semanticEmotion(text, false);
        ExpressionBehavior command = userMotion(text);
        if (head == null && !"none".equals(command.head)) head = command.head;
        if (gaze == null && !"none".equals(command.gaze)) gaze = command.gaze;
        if (depth == null) depth = command.depth;
        String defaultHead = "none", defaultGaze = "contact";
        switch (emotion) {
            case "happy": case "excited": defaultHead = "nod"; break;
            case "warm": case "caring": defaultHead = "slow_nod"; defaultGaze = "gentle"; break;
            case "thinking": defaultHead = "tilt"; defaultGaze = "thinking"; break;
            case "sad": defaultHead = "slow_nod"; defaultGaze = "soft"; break;
            case "surprised": defaultHead = "tilt"; break;
            case "angry": case "disgusted": defaultHead = "shake"; break;
            case "fearful": defaultHead = "lean"; defaultGaze = "soft"; break;
            default:
                if (any(text, "?", "？", "吗", "呢", "why", "what", "how", "would you", "do you")) {
                    defaultHead = "tilt"; defaultGaze = "gentle";
                }
        }
        if (head == null) head = defaultHead;
        if (gaze == null) gaze = defaultGaze;
    }

    private static String tag(String text, String key) {
        Matcher m = Pattern.compile("(?:\\[|<)\\s*(?:" + key + ")\\s*[-:]\\s*([A-Za-z0-9_]+)\\s*(?:\\]|>)",
                Pattern.CASE_INSENSITIVE).matcher(text);
        return m.find() ? m.group(1).toLowerCase(Locale.ROOT) : null;
    }
    private static String emotion(String s) {
        if (s == null) return null;
        s = s.toLowerCase(Locale.ROOT);
        if ("natural".equals(s)) s = "neutral";
        if ("thoughtful".equals(s)) s = "thinking";
        if ("surprise".equals(s)) s = "surprised";
        if ("fear".equals(s)) s = "fearful";
        if ("disgust".equals(s)) s = "disgusted";
        return allowed(s, new String[] {"neutral","happy","warm","caring","thinking","surprised",
                "excited","sad","angry","fearful","disgusted","curious","playful"});
    }
    private static String allowed(String s, String[] values) {
        return s != null && Arrays.asList(values).contains(s.toLowerCase(Locale.ROOT))
                ? s.toLowerCase(Locale.ROOT) : null;
    }
    private static boolean any(String s, String... words) {
        for (String word : words) if (s.contains(word)) return true;
        return false;
    }
    private static final String[] HEADS = {"none","nod","slow_nod","tilt","shake","lean","look_up","look_down","look_left","look_right"};
    private static final String[] GAZES = {"contact","gentle","soft","thinking","lower","up","left","right","none"};
    private static final String[] DEPTHS = {"none","forward","back","cycle"};
}
