import { bindings, defineConfig, defineWorker } from "cf/config";

export default defineConfig({
  worker: defineWorker({
    name: "betstatspro",
    entrypoint: "vinext/server/fetch-handler",
    compatibilityDate: "2026-11-22",
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    env: {
      ASSETS: bindings.assets(),
      VINEXT_KV_CACHE: bindings.kv({
        id: "cd19dc747e4d434bab385fd6a01942b7",
      }),
    },
  }),
});
