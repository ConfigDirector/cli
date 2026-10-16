import firebase from "firebase/compat/app";
import "firebase/compat/remote-config";

const remoteConfig = firebase.remoteConfig();
export const welcomeMessage = () => remoteConfig.getValue("welcome-message").asString();
