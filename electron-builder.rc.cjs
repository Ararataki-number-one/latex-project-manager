const packageMetadata = require("./package.json");

if (!/^\d+\.\d+\.\d+-rc\.\d+$/.test(packageMetadata.version ?? "")) {
  throw new Error("package.json version must be an RC semantic version");
}

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: "local.latex.workbench",
  productName: "LaTeX 项目管理器",
  directories: {
    output: "dist-rc"
  },
  files: [
    "out/**/*",
    "package.json"
  ],
  extraMetadata: {
    name: "latex-workbench",
    version: packageMetadata.version,
    releaseChannel: "rc"
  },
  win: {
    icon: "assets/app-icon.png",
    target: [
      "nsis",
      "portable"
    ]
  },
  nsis: {
    artifactName: "LaTeX-Project-Manager-Setup-${version}-${arch}.${ext}",
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true
  },
  portable: {
    artifactName: "LaTeX-Project-Manager-Portable-${version}-${arch}.${ext}"
  },
  publish: {
    provider: "github",
    owner: "Ararataki-number-one",
    repo: "latex-project-manager",
    releaseType: "prerelease"
  },
  generateUpdatesFilesForAllChannels: true
};
