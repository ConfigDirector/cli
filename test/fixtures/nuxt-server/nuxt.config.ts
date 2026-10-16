export default defineNuxtConfig({
  //...
  modules: ["@configdirector/nuxt-sdk"],
  runtimeConfig: {
    public: {
      configdirector: {
        // You can also provide the key at runtime to match the given environment
        // via the NUXT_PUBLIC_CONFIGDIRECTOR_CLIENT_SDK_KEY environment variable
        clientSdkKey: "YOUR-CLIENT-SDK-KEY",
      },
    },
    configdirector: {
      // IMPORTANT: This is a secret, do not commit to your source repository
      // You can provide the server key at runtime via the
      // NUXT_CONFIGDIRECTOR_SERVER_SDK_KEY environment variable
      serverSdkKey: "YOUR-SERVER-SDK-KEY",
    },
  },
});
