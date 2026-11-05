# Maleficent Chat Android companion

The Android app wraps the existing Maleficent Chat site and uses Firebase Cloud Messaging (FCM) with Android `RemoteInput` so a user can type a private-message reply directly in the notification.

## Firebase Android configuration

- Android application ID: `com.maleficentchat.app`
- Firebase project ID: `maleficentchat-48732`
- The registered Android app configuration is stored at `android/app/google-services.json`.
- The app-level Gradle file applies the Google Services plugin when that configuration file is present.

## Server configuration required

1. In Firebase Console, open Project settings → Service accounts and generate a Firebase Admin SDK private key.
2. In Render, add an environment variable named `FIREBASE_SERVICE_ACCOUNT` whose value is the complete service-account JSON document. Keep this private key only in Render; never commit it or put it in the APK.
3. Ensure Firebase Cloud Messaging is enabled for the project.
4. Redeploy the Render service after setting the variable.

The server stores FCM registration tokens and SHA-256 hashes of revocable per-device reply credentials in PostgreSQL. A device credential is issued only through the authenticated web session after login. Native reply requests use that credential and re-check account moderation, network restrictions, maintenance mode, private-message feature grants, and user blocks.

## Build

Open `android/` in Android Studio with JDK 17 and Android SDK 35. Allow Gradle sync, then build the debug APK.

## Important test status

The Firebase Android configuration and server/device integration code are committed, but no APK has yet been built or tested on a physical Android device. Confirm notification permission, FCM delivery, login/device registration, logout/account switching, and inline reply delivery before treating this as production-ready.
