const path = require('path');

function getProfile() {
  const profile = (process.env.AMOS_PROFILE || 'standard').toLowerCase();
  if (['minimal', 'standard', 'strict'].includes(profile)) {
    return profile;
  }
  return 'standard';
}

function isDisabled() {
  return process.env.AMOS_DISABLE === '1';
}

module.exports = {
  getProfile,
  isDisabled,
  AMOS_DIR: path.resolve(__dirname, '..')
};
