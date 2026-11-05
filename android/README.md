# Maleficent Chat Android companion

The native Android shell opens the existing website and defines Firebase Cloud Messaging plus Android `RemoteInput` notification-reply components.

## Setup required
1. Create a Firebase project and register Android application ID `com.maleficentchat.app`.
2. Add the generated `google-services.json` to `android/app/` (do not commit service-account private keys).
3. Configure Firebase Admin credentials securely in Render.
4. Implement authenticated device-token registration and FCM delivery on the server. The current Android service stores the FCM token locally only.
5. Implement secure reply delivery to `/api/dm/:peerId`. The current receiver captures typed text locally but does not send it; this must use a revocable per-device credential, never an account password embedded in the APK.

Open `android/` in Android Studio with JDK 17 and Android SDK 35 to build after Firebase setup. No APK has been built or device-tested yet.
