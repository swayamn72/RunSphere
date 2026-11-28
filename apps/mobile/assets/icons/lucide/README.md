# Lucide icons

Unmodified SVGs from [Lucide](https://lucide.dev), package `lucide-static` 1.82.0, ISC licence
(see `LICENSE`, which ships with them).

The app draws them through `src/components/Icon.tsx`. To add one:

```sh
npm pack lucide-static@1.82.0            # then copy icons/<name>.svg into this folder
node apps/mobile/scripts/generate-icons.mjs
npx prettier --write apps/mobile/src/components/lucide-icons.ts
```

`src/components/lucide-icons.test.ts` fails if the generated file and this folder disagree.
