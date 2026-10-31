import java.io.InputStream;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.cert.Certificate;
import java.security.cert.X509Certificate;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;

/** JDK cryptographic verification of every non-META-INF AAB payload entry. */
public class VerifyBundle {
    public static void main(String[] args) throws Exception {
        int payloads = 0;
        byte[] signer = null;
        try (JarFile bundle = new JarFile(Path.of(args[0]).toFile(), true)) {
            if (bundle.getManifest() == null) throw new SecurityException("AAB has no signing manifest");
            var entries = bundle.entries();
            byte[] bytes = new byte[65536];
            while (entries.hasMoreElements()) {
                JarEntry entry = entries.nextElement();
                if (entry.isDirectory() || entry.getName().startsWith("META-INF/")) continue;
                try (InputStream stream = bundle.getInputStream(entry)) {
                    while (stream.read(bytes) != -1) { /* Authenticate the complete entry. */ }
                }
                var codeSigners = entry.getCodeSigners();
                if (codeSigners == null || codeSigners.length != 1)
                    throw new SecurityException("Unsigned or ambiguous bundle payload: " + entry.getName());
                Certificate certificate = codeSigners[0].getSignerCertPath().getCertificates().get(0);
                if (!(certificate instanceof X509Certificate)) throw new SecurityException("Missing X509 upload certificate");
                byte[] current = certificate.getEncoded();
                if (signer == null) signer = current;
                else if (!Arrays.equals(signer, current)) throw new SecurityException("Mixed bundle signing identities");
                payloads++;
            }
        }
        if (payloads == 0 || signer == null) throw new SecurityException("No authenticated bundle payload");
        String sha = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(signer));
        System.out.println("SIGNED_PAYLOAD_COUNT=" + payloads);
        System.out.println("UPLOAD_CERTIFICATE_SHA256=" + sha);
    }
}
