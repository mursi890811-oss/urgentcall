// Resolves a documented manifest-merger conflict between expo-notifications and
// @react-native-firebase/messaging: both libraries inject
// com.google.firebase.messaging.default_notification_color and
// .default_notification_channel_id meta-data into AndroidManifest.xml.
// firebase.json (project root) sets the values @react-native-firebase/messaging uses,
// but expo-notifications' plugin unconditionally writes its own literal values for the
// same two keys into the generated manifest, which collides at Gradle's manifest-merge
// step (see https://github.com/invertase/react-native-firebase/issues/8165 and #3559).
// This plugin adds tools:replace so our expo-notifications-authored values win — they
// match what firebase.json declares, since they share the same channel id ("urgentcall-alarm")
// and color resource.
const { withAndroidManifest } = require("@expo/config-plugins");

// Maps each conflicting meta-data key to the XML attribute expo-notifications sets on it
// (channel id uses android:value, color uses android:resource) so tools:replace targets
// the attribute that's actually present.
const CONFLICTING_META = {
  "com.google.firebase.messaging.default_notification_color": "android:resource",
  "com.google.firebase.messaging.default_notification_channel_id": "android:value",
};

function withFcmManifestFix(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    const app = manifest.manifest.application?.[0];
    if (!app || !app["meta-data"]) return config;

    for (const meta of app["meta-data"]) {
      const name = meta.$?.["android:name"];
      const attr = CONFLICTING_META[name];
      console.log("[withFcmManifestFix] meta-data:", name, "attr:", attr);
      if (attr) {
        meta.$["tools:replace"] = attr;
        console.log("[withFcmManifestFix] SET tools:replace on", name, JSON.stringify(meta.$));
      }
    }

    if (manifest.manifest.$ && !manifest.manifest.$["xmlns:tools"]) {
      manifest.manifest.$["xmlns:tools"] = "http://schemas.android.com/tools";
    }

    return config;
  });
}

module.exports = withFcmManifestFix;
