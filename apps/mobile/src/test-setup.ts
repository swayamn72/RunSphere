// Mock image asset requires in Vitest Node environment
if (typeof require !== 'undefined' && require.extensions) {
  require.extensions['.png'] = (module) => {
    module.exports = 1;
  };
  require.extensions['.jpg'] = (module) => {
    module.exports = 1;
  };
  require.extensions['.webp'] = (module) => {
    module.exports = 1;
  };
}
