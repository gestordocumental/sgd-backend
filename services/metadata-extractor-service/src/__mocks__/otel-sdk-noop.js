class NodeSDK {
  constructor() {}
  start() {}
  shutdown() { return Promise.resolve(); }
}

module.exports = { NodeSDK };
