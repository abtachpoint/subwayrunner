import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.jar.JarEntry;
import java.util.jar.JarInputStream;

/** Independent standard-JDK sequential verifier, not the APK builder. */
public class VerifyLocalJar {
    public static void main(String[] args) throws Exception {
        int signed = 0;
        try (InputStream source = Files.newInputStream(Path.of(args[0]));
             JarInputStream jar = new JarInputStream(source, true)) {
            if (jar.getManifest() == null) {
                throw new SecurityException("Manifest unavailable to streaming JAR reader");
            }
            byte[] buffer = new byte[32768];
            for (JarEntry entry; (entry = jar.getNextJarEntry()) != null;) {
                while (jar.read(buffer) != -1) { /* Fully read before signer check. */ }
                if (!entry.isDirectory() && !entry.getName().startsWith("META-INF/")) {
                    if (entry.getCodeSigners() == null || entry.getCodeSigners().length != 1) {
                        throw new SecurityException("Unauthenticated payload: " + entry.getName());
                    }
                    signed++;
                }
            }
        }
        if (signed < 7) throw new SecurityException("Incomplete game payload: " + signed);
        System.out.println("PASS: JDK streaming verifier authenticated " + signed + " APK payload files.");
    }
}
