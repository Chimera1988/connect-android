/** Local Android decoding, independent of playback and microphone permission. */
const fs = require('node:fs');
const path = require('node:path');
const {withDangerousMod, withMainApplication} = require('expo/config-plugins');

function registerPackage(contents, language) {
  const registration = language === 'kt'
    ? 'add(com.connect.waveform.ConnectWaveformPackage())'
    : 'packages.add(new com.connect.waveform.ConnectWaveformPackage());';
  if (contents.includes(registration)) return contents;
  if (language === 'kt') {
    const anchor = /PackageList\(this\)\.packages\.apply\s*\{/;
    if (!anchor.test(contents)) throw new Error('Connect waveform: unsupported Kotlin MainApplication package list');
    return contents.replace(anchor, match => `${match}\n          ${registration}`);
  }
  const anchor = /List<ReactPackage>\s+packages\s*=\s*new PackageList\(this\)\.getPackages\(\);/;
  if (!anchor.test(contents)) throw new Error('Connect waveform: unsupported Java MainApplication package list');
  return contents.replace(anchor, match => `${match}\n      ${registration}`);
}

module.exports = function withConnectWaveform(config) {
  config = withMainApplication(config, mod => {
    mod.modResults.contents = registerPackage(mod.modResults.contents, mod.modResults.language);
    return mod;
  });
  return withDangerousMod(config, ['android', async mod => {
    const destination = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/java/com/connect/waveform');
    fs.mkdirSync(destination, {recursive: true});
    for (const filename of ['ConnectWaveformModule.java', 'ConnectWaveformPackage.java']) {
      fs.copyFileSync(path.join(__dirname, 'waveform', filename), path.join(destination, filename));
    }
    return mod;
  }]);
};
module.exports.registerPackage = registerPackage;
