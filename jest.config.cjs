module.exports = {
  testEnvironment: "jsdom",
  collectCoverageFrom: ["lib.js"],
  coverageThreshold: {
    global: {
      branches: 90,
      functions: 100,
      lines: 90,
      statements: 90,
    },
  },
};
