// Custom entry point (replaces the default "expo-router/entry").
//
// @react-native-firebase/messaging requires setBackgroundMessageHandler to be called
// at the very top of the JS bundle, outside of any React component lifecycle, and BEFORE
// the rest of the app loads — otherwise Android will not reliably invoke it when the app
// is backgrounded/killed and a data message arrives. This file registers that handler
// first, then hands off to expo-router exactly as the default entry point would.
import { registerBackgroundHandler } from "@/src/notifications/push";

registerBackgroundHandler();

import "expo-router/entry";
