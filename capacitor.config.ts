const config = {
  appId: 'com.voxelyn.diceexpedition',
  appName: 'Voxelyn Dice Expedition',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
    androidScheme: 'https',
  },
  cordova: {
    preferences: {
      Orientation: 'portrait',
    },
  },
};

export default config;
