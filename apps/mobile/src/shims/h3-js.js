/**
 * h3-js stub for React Native / Hermes.
 *
 * h3-js uses WebAssembly internally, which cannot run in Hermes (the React Native
 * JS engine). All H3 indexing is performed server-side; the mobile client never
 * calls these functions directly. This stub keeps Metro happy while ensuring a
 * loud error if any mobile code accidentally invokes an H3 function at runtime.
 */
const stub = new Proxy(
  {},
  {
    get(_, prop) {
      return () => {
        throw new Error(
          `h3-js is not available in React Native. ` +
          `'${String(prop)}' must only be called server-side. ` +
          `Check your import tree — a domain utility using H3 was imported in the mobile bundle.`
        );
      };
    },
  }
);

module.exports = stub;
