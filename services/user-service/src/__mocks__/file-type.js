// Manual mock for file-type (ESM-only package not reachable by Jest's CJS resolver).
// Tests configure fileTypeFromBuffer.mockResolvedValue(...) per scenario.
const fileTypeFromBuffer = jest.fn();
module.exports = { fileTypeFromBuffer };
