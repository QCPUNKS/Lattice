// Deliberately introduced bug for the end-to-end fixture (spec §61): should be a + b.
module.exports.add = function add(a, b) {
  return a - b;
};
