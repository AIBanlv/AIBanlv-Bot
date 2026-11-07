import com.zhanlv.digitalhuman.playback.ExpressionBehavior;

public final class ControlPreviewTest {
    public static void main(String[] args) {
        ExpressionBehavior b = ControlPreview.parse("[E:happy][H:shake]Hello.");
        require("happy".equals(b.emotion) && b.explicitEmotion, "emotion");
        require("shake".equals(b.head) && "Hello.".equals(b.text), "head and clean text");
        b = ControlPreview.parse("\u3010\u6447\u6447\u5934\u3011\u4f60\u597d\u3002");
        require("shake".equals(b.head) && "\u4f60\u597d\u3002".equals(b.text), "Chinese alias");
        b = ControlPreview.parse("<E:happy>[head-look_left][eye-left][depth:forward]Hello");
        require("look_left".equals(b.head) && "left".equals(b.gaze)
                && "forward".equals(b.depth), "canonical tags");
        require("none".equals(ControlPreview.parse("[H:none]Hello").head), "explicit none");
        for (String text : new String[] {"", "[H:shake]", "[H:invalid]Hi", "[unknown]Hi",
                "[H:shake][head:nod]Hi", "[H:shake", "Hi]", "[[H:shake]]Hi",
                "<audio src='file'>Hi", "Hi\u0000", "a".repeat(161)}) {
            try { ControlPreview.parse(text); throw new AssertionError("Accepted invalid input"); }
            catch (IllegalArgumentException expected) { }
        }
        System.out.println("Control tags: canonical parser, Chinese aliases, stripping and rejection passed");
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
