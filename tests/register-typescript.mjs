import { existsSync } from "node:fs";
import { registerHooks } from "node:module";

// Nodeの型除去を使い、アプリの拡張子なし相対importをテストでも解決する。
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && context.parentURL && !/\.[a-z]+$/i.test(specifier)) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(url)) {
        return nextResolve(url.href, context);
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    return nextLoad(url, url.endsWith(".ts") ? { ...context, format: "module-typescript" } : context);
  },
});
