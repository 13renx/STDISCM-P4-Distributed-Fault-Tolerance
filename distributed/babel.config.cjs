// Babel config for the distributed subsystem's Jest tests.
// Transpiles ESM so Jest can run the .js modules under Node.
module.exports = {
  presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
};
