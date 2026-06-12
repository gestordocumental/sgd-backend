class OTLPTraceExporter {
  constructor() {}
  export(_spans, resultCallback) { resultCallback({ code: 0 }); }
  shutdown() { return Promise.resolve(); }
}

module.exports = { OTLPTraceExporter };
