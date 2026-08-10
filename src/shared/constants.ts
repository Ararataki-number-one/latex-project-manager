export const MANIFEST_DIRECTORY = ".latex-workbench";
export const MANIFEST_FILE = "project.json";
export const SCHEMA_VERSION = 1;
export const DEFAULT_SCAN_DEPTH = 3;
export const DEFAULT_IGNORED_DIRECTORIES = [
  ".git",
  ".idea",
  ".vscode",
  ".latex-workbench",
  "node_modules",
  "build",
  "dist",
  "out"
];

export const MANAGED_MARKERS = {
  class: {
    begin: "%% <latex-workbench:begin id=\"class\" version=\"1\">",
    end: "%% <latex-workbench:end id=\"class\">"
  },
  packages: {
    begin: "%% <latex-workbench:begin id=\"packages\" version=\"1\">",
    end: "%% <latex-workbench:end id=\"packages\">"
  },
  structure: {
    begin: "%% <latex-workbench:begin id=\"structure\" version=\"1\">",
    end: "%% <latex-workbench:end id=\"structure\">"
  }
} as const;

export const ELEGANTBOOK_FORK_HASH = "01c64c1e479d8a21e8cf5b7b6cf907449caa5b5c8a6f8241c1812a77ab3a4b7f";
