const packageMetadata = require("./package.json");

const betaVersion = packageMetadata.config?.betaVersion;
if (!/^\d+\.\d+\.\d+-beta\.\d+$/.test(betaVersion ?? "")) {
  throw new Error("package.json config.betaVersion must be a beta semantic version");
}

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: "local.latex.workbench.beta",
  productName: "LaTeX 项目管理器 Beta",
  directories: {
    output: "dist-beta"
  },
  files: [
    "out/**/*",
    "package.json"
  ],
  extraMetadata: {
    name: "latex-workbench-beta",
    version: betaVersion,
    releaseChannel: "beta"
  },
  win: {
    icon: "assets/app-icon.png",
    target: [
      "nsis",
      "portable"
    ]
  },
  nsis: {
    artifactName: "LaTeX-Project-Manager-Beta-Setup-${version}-${arch}.${ext}",
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true
  },
  portable: {
    artifactName: "LaTeX-Project-Manager-Beta-Portable-${version}-${arch}.${ext}"
  },
  publish: {
    provider: "github",
    owner: "Ararataki-number-one",
    repo: "latex-project-manager",
    releaseType: "prerelease"
  },
  generateUpdatesFilesForAllChannels: true
};
