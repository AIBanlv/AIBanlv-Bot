import java.lang.reflect.*;
import org.junit.jupiter.api.Test;

/** Local fallback runner for isolated source tests when Maven BOM resolution is unavailable. */
public class ControlSourceTestRunner {
    public static void main(String[] args) throws Exception {
        int count = 0, failures = 0;
        for (String name : args) {
            Class<?> type = Class.forName(name);
            for (Method method : type.getDeclaredMethods()) {
                if (method.getAnnotation(Test.class) == null) continue;
                Constructor<?> constructor = type.getDeclaredConstructor(); constructor.setAccessible(true);
                method.setAccessible(true);
                try { method.invoke(constructor.newInstance()); System.out.println("PASS " + name + "." + method.getName()); count++; }
                catch (InvocationTargetException error) { failures++; System.err.println("FAIL " + name + "." + method.getName()); error.getCause().printStackTrace(); }
            }
        }
        System.out.println("PASS " + count + " isolated Java source tests");
        if (failures > 0) throw new AssertionError(failures + " source test failures");
    }
}
